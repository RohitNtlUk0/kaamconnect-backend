import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { UsersService } from '../../users/users.service';

export interface JwtPayload {
  sub: string;
  uid: string;
  role: string;
  phone?: string;
  name?: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private configService: ConfigService,
    private usersService: UsersService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get('jwt.secret') || 'kaamconnect_secret_fallback',
    });
  }

  async validate(payload: JwtPayload) {
    // 1. Root and Platform Administrator bypass database lookup
    if (payload.sub === 'admin_root' || payload.role === 'ADMIN' || payload.role === 'SUPER_ADMIN') {
      return {
        id: payload.sub,
        role: payload.role || 'ADMIN',
        full_name: payload.name || 'Master Admin Control Room',
        phone_number: payload.phone || '+910000000000',
        is_active: true,
        is_verified: true,
      };
    }

    // 2. Standard user verification
    const user = await this.usersService.findById(payload.sub);
    if (!user || !user.is_active) {
      throw new UnauthorizedException('User account does not exist or has been disabled.');
    }
    return user;
  }
}

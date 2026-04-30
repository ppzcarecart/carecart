import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';

import { UsersService } from '../users/users.service';
import { User } from '../users/entities/user.entity';
import { Role } from '../common/enums/role.enum';
import { RegisterDto } from './dto/register.dto';
import { PointsService } from '../points/points.service';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private users: UsersService,
    private jwt: JwtService,
    private points: PointsService,
    @InjectRepository(User) private userRepo: Repository<User>,
  ) {}

  async validate(email: string, password: string): Promise<User> {
    const user = await this.users.findByEmail(email);
    if (!user || !user.active) throw new UnauthorizedException('Invalid credentials');
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) throw new UnauthorizedException('Invalid credentials');
    return user;
  }

  async login(email: string, password: string) {
    const user = await this.validate(email, password);

    // PPZ users that have linked their account get a fresh balance/lifetime
    // pull from the partner app on every direct sign-in. Best-effort —
    // partner outages must not break login.
    if (user.ppzId) {
      try {
        await this.points.syncProfile(user.id);
      } catch (e: any) {
        this.logger.warn(
          `PPZ sync after login failed for user ${user.id}: ${e?.message}`,
        );
      }
    }

    return this.issueToken(user);
  }

  async register(dto: RegisterDto) {
    const existing = await this.users.findByEmail(dto.email);
    if (existing) throw new ConflictException('Email already registered');
    const user = await this.users.createUser({
      email: dto.email,
      password: dto.password,
      name: dto.name,
      contact: dto.contact,
      role: Role.CUSTOMER,
      address: dto.address,
    });
    return this.issueToken(user);
  }

  /**
   * Set or change the signed-in user's password. If the user has never
   * set one (handoff-created accounts) the current-password check is
   * skipped — they wouldn't know it. After the first set, a current
   * password is required.
   */
  async setPassword(
    userId: string,
    newPassword: string,
    currentPassword?: string,
  ) {
    if (!newPassword || newPassword.length < 6) {
      throw new BadRequestException('New password must be at least 6 characters');
    }
    const user = await this.users.findById(userId);
    if (!user) throw new NotFoundException('User not found');

    // PPZ users never need the current-password challenge: they may have
    // come in via handoff and never seen their auto-generated bcrypt hash.
    // The active session is the proof of identity. Non-PPZ users still get
    // the standard challenge once they've explicitly set a password.
    const requireCurrent = user.hasSetPassword && !user.ppzId;
    if (requireCurrent) {
      if (!currentPassword) {
        throw new BadRequestException('Current password is required');
      }
      const ok = await bcrypt.compare(currentPassword, user.passwordHash);
      if (!ok) throw new UnauthorizedException('Current password is incorrect');
    }

    user.passwordHash = await bcrypt.hash(newPassword, 10);
    user.hasSetPassword = true;
    await this.userRepo.save(user);
    return { ok: true, hasSetPassword: true };
  }

  issueToken(user: User) {
    const payload = { sub: user.id, email: user.email, role: user.role, name: user.name };
    return {
      access_token: this.jwt.sign(payload),
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
    };
  }
}

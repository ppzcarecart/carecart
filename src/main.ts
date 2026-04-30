import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe } from '@nestjs/common';
import cookieParser = require('cookie-parser');
import { join } from 'path';
import { AppModule } from './app.module';
import { SettingsService } from './settings/settings.service';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
  });

  app.use(cookieParser());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: false,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  app.useStaticAssets(join(process.cwd(), 'public'));
  app.setBaseViewsDir(join(process.cwd(), 'views'));
  app.setViewEngine('ejs');

  // Inject runtime settings into res.locals so every EJS template
  // (specifically the nav partial) can read partnerCloseUrl without each
  // controller threading it through. SettingsService caches in memory,
  // so this is a sync map lookup per request.
  const settings = app.get(SettingsService);
  app.use((_req: any, res: any, next: any) => {
    res.locals.partnerCloseUrl = settings.get('partner.closeUrl') || '';
    next();
  });

  const port = parseInt(process.env.PORT || '3000', 10);
  await app.listen(port, '0.0.0.0');
  // eslint-disable-next-line no-console
  console.log(`carecart listening on :${port}`);
}

bootstrap();

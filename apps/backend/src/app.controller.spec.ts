import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [AppService],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('root', () => {
    it('should return the operational health HTML', () => {
      // AppService.getHello() returns an HTML health-check page (the
      // `🚀 Vendix Backend` markup). The test was asserting the old
      // "Hello World!" return value that was replaced when the health
      // endpoint moved onto an HTML payload. Assert against the markers
      // that prove the service ran end-to-end without pinning the whole
      // markup (which would break every time the template tweaks a
      // timestamp / version line).
      const html = appController.getHello();
      expect(html).toContain('Vendix Backend');
      expect(html).toContain('System operational and healthy');
    });
  });
});

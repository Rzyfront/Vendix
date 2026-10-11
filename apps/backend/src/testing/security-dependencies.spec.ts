import 'reflect-metadata';
import { Controller, Get } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { createRequire } from 'node:module';
import request = require('supertest');

// Resolve from Swagger itself: the ordinary backend js-yaml remains on v4.
const swaggerRequire = createRequire(require.resolve('@nestjs/swagger/package.json'));
const yaml = swaggerRequire('js-yaml') as {
  load(source: string): unknown;
  dump(value: unknown): string;
};

@Controller('security-fixture')
class SecurityFixtureController {
  @Get()
  getFixture(): { ok: boolean } {
    return { ok: true };
  }
}

describe('security dependency contracts: Swagger YAML', () => {
  it('loads ordinary YAML and rejects malformed YAML and executable tags', () => {
    const fixture = { enabled: true, count: 3, values: ['a', 'b'] };
    expect(yaml.load(yaml.dump(fixture))).toEqual(fixture);
    expect(() => yaml.load('values: [unterminated')).toThrow();
    expect(() => yaml.load('value: !!js/function "function () {}"')).toThrow();
  });

  it('serves matching OpenAPI JSON and YAML using the real Swagger serializer', async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [SecurityFixtureController],
    }).compile();
    const app = moduleRef.createNestApplication();
    try {
      const document = SwaggerModule.createDocument(
        app,
        new DocumentBuilder().setTitle('Security fixture').setVersion('1').build(),
      );
      SwaggerModule.setup('api', app, document);
      await app.init();
      const json = await request(app.getHttpServer()).get('/api-json').expect(200);
      const serialized = await request(app.getHttpServer()).get('/api-yaml').expect(200);
      expect(json.body.paths['/security-fixture'].get).toBeDefined();
      expect(yaml.load(serialized.text)).toEqual(json.body);
    } finally {
      await app.close();
    }
  });
});

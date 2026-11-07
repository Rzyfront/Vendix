import { BasePdfPagesService } from './base-pdf-pages.service';

describe('BasePdfPagesService', () => {
  it('turns the prepared pages into JPEG bytes with their size in PDF points', async () => {
    const pages = {
      prepare: jest.fn().mockResolvedValue({
        page_count: 1,
        pages: [{ page_number: 1, data_uri: `data:image/jpeg;base64,${Buffer.from('jpegbytes').toString('base64')}`, mime_type: 'image/jpeg', text: '', width_pt: 612, height_pt: 792 }],
      }),
    };
    const out = await new BasePdfPagesService(pages as never).rasterize(Buffer.from('%PDF-1.4'));
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ page: 1, width_pt: 612, height_pt: 792 });
    expect(out[0].image.toString()).toBe('jpegbytes');
    expect(pages.prepare).toHaveBeenCalledWith(expect.objectContaining({ mimetype: 'application/pdf' }));
  });

  it('an unreadable PDF becomes a template error with a readable message', async () => {
    const pages = { prepare: jest.fn().mockRejectedValue(new Error('El PDF excede el máximo de 10 páginas.')) };
    await expect(new BasePdfPagesService(pages as never).rasterize(Buffer.from('%PDF-'))).rejects.toMatchObject({
      errorCode: 'DOCTPL_INVALID',
      message: expect.stringContaining('10 páginas'),
    });
  });
});

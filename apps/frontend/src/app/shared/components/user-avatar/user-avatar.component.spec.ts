import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  resolveAvatarSrc,
  UserAvatarComponent,
} from './user-avatar.component';
import { toDocumentTypeCode } from '../../constants/document-types';

describe('UserAvatarComponent', () => {
  let fixture: ComponentFixture<UserAvatarComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [UserAvatarComponent] });
    fixture = TestBed.createComponent(UserAvatarComponent);
  });

  function render(src: string | null, initials = 'RM'): HTMLElement {
    fixture.componentRef.setInput('src', src);
    fixture.componentRef.setInput('initials', initials);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('shows the photo instead of the initials when there is a signed URL', () => {
    const el = render('https://bucket.s3.amazonaws.com/a.webp?X-Amz-Signature=x');
    const img = el.querySelector('img');
    expect(img?.getAttribute('src')).toBe(
      'https://bucket.s3.amazonaws.com/a.webp?X-Amz-Signature=x',
    );
    expect(el.textContent?.trim()).toBe('');
  });

  it('shows the initials when there is no photo', () => {
    const el = render(null);
    expect(el.querySelector('img')).toBeNull();
    expect(el.textContent?.trim()).toBe('RM');
  });

  it('treats a bare S3 key as no photo (it would 404 on the frontend host)', () => {
    const el = render('organizations/o/users/1/avatars/a.webp');
    expect(el.querySelector('img')).toBeNull();
    expect(el.textContent?.trim()).toBe('RM');
  });

  it('falls back to the initials and emits loadError when the image fails', () => {
    const errors: string[] = [];
    fixture.componentInstance.loadError.subscribe((u) => errors.push(u));
    const el = render('https://bucket.s3.amazonaws.com/expired.webp');
    el.querySelector('img')!.dispatchEvent(new Event('error'));
    fixture.detectChanges();
    expect(el.querySelector('img')).toBeNull();
    expect(el.textContent?.trim()).toBe('RM');
    expect(errors).toEqual(['https://bucket.s3.amazonaws.com/expired.webp']);
  });

  it('retries with a new URL after a failure', () => {
    const el = render('https://bucket.s3.amazonaws.com/expired.webp');
    el.querySelector('img')!.dispatchEvent(new Event('error'));
    fixture.detectChanges();
    render('https://bucket.s3.amazonaws.com/fresh.webp');
    expect(el.querySelector('img')?.getAttribute('src')).toBe(
      'https://bucket.s3.amazonaws.com/fresh.webp',
    );
  });

  it('resolveAvatarSrc accepts data: URLs and rejects empty values', () => {
    expect(resolveAvatarSrc('data:image/png;base64,AA')).toBe('data:image/png;base64,AA');
    expect(resolveAvatarSrc('')).toBeNull();
  });
});

describe('toDocumentTypeCode', () => {
  it('uppercases and trims enum codes', () => {
    expect(toDocumentTypeCode('cc')).toBe('CC');
    expect(toDocumentTypeCode(' Cc ')).toBe('CC');
    expect(toDocumentTypeCode('nit')).toBe('NIT');
  });

  it('maps legacy passport values to PA', () => {
    expect(toDocumentTypeCode('pas')).toBe('PA');
    expect(toDocumentTypeCode('PASSPORT')).toBe('PA');
  });

  it('returns null for empty or unknown values', () => {
    expect(toDocumentTypeCode('')).toBeNull();
    expect(toDocumentTypeCode(null)).toBeNull();
    expect(toDocumentTypeCode('OTHER')).toBeNull();
  });
});

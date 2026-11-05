import { Pipe, PipeTransform } from '@angular/core';
import {
  ProviderNameLike,
  providerDisplayName,
} from '../../utils/provider-display-name';

/** Template wrapper of `providerDisplayName`. */
@Pipe({ name: 'providerName', standalone: true })
export class ProviderNamePipe implements PipeTransform {
  transform(provider: ProviderNameLike | null | undefined): string {
    return providerDisplayName(provider);
  }
}

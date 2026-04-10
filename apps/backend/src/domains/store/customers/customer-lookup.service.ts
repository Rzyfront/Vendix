import { Injectable } from '@nestjs/common';
import { CustomersService } from './customers.service';

export interface CustomerLookupResult {
  customer: any;
  needs_store_link: boolean;
  linked: boolean;
}

export interface ExternalDocumentLookupProvider {
  lookup(
    documentNumber: string,
    documentType?: string,
  ): Promise<ExternalLookupResult | null>;
}

export interface ExternalLookupResult {
  first_name: string;
  last_name: string;
  document_type: string;
  document_number: string;
  email?: string;
  phone?: string;
  address?: string;
}

@Injectable()
export class CustomerLookupService {
  constructor(private readonly customersService: CustomersService) {}

  async lookupByDocument(
    storeId: number,
    organizationId: number,
    documentNumber: string,
    documentType?: string,
  ): Promise<CustomerLookupResult | null> {
    const user = await this.customersService.findByDocumentInOrganization(
      organizationId,
      documentNumber,
      documentType,
    );

    if (!user) {
      return null;
    }

    const hasStoreLink = user.store_users?.some(
      (su: any) => su.store_id === storeId,
    );

    if (hasStoreLink) {
      return {
        customer: user,
        needs_store_link: false,
        linked: false,
      };
    }

    await this.customersService.linkCustomerToStore(user.id, storeId);

    return {
      customer: user,
      needs_store_link: true,
      linked: true,
    };
  }
}

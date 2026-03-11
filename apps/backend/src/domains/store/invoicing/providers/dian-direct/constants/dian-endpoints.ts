/**
 * DIAN SOAP web service endpoints for electronic invoicing.
 *
 * Test (habilitación): Used during the enablement/testing phase.
 * Production: Used once the company is fully enabled with DIAN.
 */
export const DIAN_ENDPOINTS = {
  test: {
    url: 'https://vpfe-hab.dian.gov.co/WcfDianCustomerServices.svc',
    wsdl: 'https://vpfe-hab.dian.gov.co/WcfDianCustomerServices.svc?wsdl',
  },
  production: {
    url: 'https://vpfe.dian.gov.co/WcfDianCustomerServices.svc',
    wsdl: 'https://vpfe.dian.gov.co/WcfDianCustomerServices.svc?wsdl',
  },
} as const;

/**
 * SOAP actions for the DIAN web service operations.
 */
export const DIAN_SOAP_ACTIONS = {
  SendBillSync:
    'http://wcf.dian.colombia/IWcfDianCustomerServices/SendBillSync',
  SendTestSetAsync:
    'http://wcf.dian.colombia/IWcfDianCustomerServices/SendTestSetAsync',
  GetStatus:
    'http://wcf.dian.colombia/IWcfDianCustomerServices/GetStatus',
  GetStatusZip:
    'http://wcf.dian.colombia/IWcfDianCustomerServices/GetStatusZip',
} as const;

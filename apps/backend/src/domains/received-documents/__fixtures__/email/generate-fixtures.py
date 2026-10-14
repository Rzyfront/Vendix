#!/usr/bin/env python3
"""Deterministic, small, synthetic email corpus. No network, secrets or real invoices.

Run without arguments to regenerate only the files owned by this generator.
Run --verify to validate the committed corpus without writing anything.
Not an integration test: no claim about Vendix ingestion or DIAN authentication.
"""
import base64
import copy
import hashlib
import io
import json
import struct
import sys
import zipfile
from email import policy
from email.message import EmailMessage
from email.parser import BytesParser
from pathlib import Path
from xml.etree import ElementTree as ET
from xml.sax.saxutils import escape

ROOT = Path(__file__).resolve().parent
CBC = 'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2'
CAC = 'urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2'
NIT = '800765432'
ISSUER = '900123456'
CC = '1118860776'
ALIAS = 'facturas-00112233445566778899aabbccddeeff@recepcion.vendix.online'
TOPIC = 'arn:aws:sns:us-east-1:123456789012:email-reception-fixture-prod'
BUCKET = 'vendix-email-fixture-prod'
TIMESTAMP = '2026-10-13T17:34:00.000Z'
DATA = {}
ENTRIES = []


def dv(nit):
    weights = [3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47, 53, 59, 67, 71]
    residue = sum(int(digit) * weight for digit, weight in zip(reversed(nit), weights)) % 11
    return str(11 - residue if residue > 1 else residue)


def key(label):
    return hashlib.sha384(('synthetic-email-fixture:' + label).encode()).hexdigest()


def add(name, content, outcome, **extra):
    content = content.encode('utf-8') if isinstance(content, str) else content
    DATA[name] = content
    ENTRIES.append({'path': name, 'provenance': 'synthetic', 'bytes': len(content),
                    'sha256': hashlib.sha256(content).hexdigest(), 'expected': outcome, **extra})
    return content


def party(tag, taxid, name, scheme='31', digit=None):
    digit = dv(taxid) if digit is None and scheme == '31' and taxid.isdigit() else digit
    attrs = f' schemeName="{scheme}"' if scheme else ''
    if digit not in (None, ''):
        attrs += f' schemeID="{digit}"'
    body = f'''<cac:Party><cac:PartyTaxScheme><cbc:RegistrationName>{name}</cbc:RegistrationName>
      <cbc:CompanyID{attrs}>{taxid}</cbc:CompanyID><cbc:TaxLevelCode>R-99-PN</cbc:TaxLevelCode>
      <cac:TaxScheme><cbc:ID>01</cbc:ID><cbc:Name>IVA</cbc:Name></cac:TaxScheme></cac:PartyTaxScheme>
      <cac:PartyLegalEntity><cbc:RegistrationName>{name}</cbc:RegistrationName><cbc:CompanyID{attrs}>{taxid}</cbc:CompanyID></cac:PartyLegalEntity></cac:Party>'''
    return f'<cac:{tag}>{body}</cac:{tag}>'


def business(label='invoice', root='Invoice', code='01', receiver=NIT, scheme='31', digit=None,
             environment='1', encoding='UTF-8'):
    scheme_key = 'CUFE-SHA384' if root == 'Invoice' and code != '20' else 'CUDE-SHA384'
    line = {'Invoice': 'InvoiceLine', 'CreditNote': 'CreditNoteLine', 'DebitNote': 'DebitNoteLine'}[root]
    qty = {'Invoice': 'InvoicedQuantity', 'CreditNote': 'CreditedQuantity', 'DebitNote': 'DebitedQuantity'}[root]
    total = 'RequestedMonetaryTotal' if root == 'DebitNote' else 'LegalMonetaryTotal'
    # UBL DebitNote-2 has no DebitNoteTypeCode; code 92 is inferred from root.
    type_tag = 'InvoiceTypeCode' if root == 'Invoice' else 'CreditNoteTypeCode'
    type_element = '' if root == 'DebitNote' else f'<cbc:{type_tag}>{code}</cbc:{type_tag}>'
    customization = '10' if root == 'Invoice' else '20' if root == 'CreditNote' else '30'
    prefix = {'Invoice': 'FE', 'CreditNote': 'NC', 'DebitNote': 'ND'}[root]
    profile = {'Invoice': 'DIAN 2.1: Factura Electrónica de Venta', 'CreditNote': 'DIAN 2.1: Nota Crédito de Factura Electrónica de Venta', 'DebitNote': 'DIAN 2.1: Nota Débito de Factura Electrónica de Venta'}[root]
    tax = '''<cac:TaxTotal><cbc:TaxAmount currencyID="COP">19000.00</cbc:TaxAmount><cac:TaxSubtotal><cbc:TaxableAmount currencyID="COP">100000.00</cbc:TaxableAmount><cbc:TaxAmount currencyID="COP">19000.00</cbc:TaxAmount><cac:TaxCategory><cbc:Percent>19</cbc:Percent><cac:TaxScheme><cbc:ID>01</cbc:ID><cbc:Name>IVA</cbc:Name></cac:TaxScheme></cac:TaxCategory></cac:TaxSubtotal></cac:TaxTotal>'''
    reference = '' if root == 'Invoice' else f'''<cac:DiscrepancyResponse><cbc:ReferenceID>FE-invoice</cbc:ReferenceID><cbc:ResponseCode>1</cbc:ResponseCode><cbc:Description>Ajuste sintético de prueba</cbc:Description></cac:DiscrepancyResponse><cac:BillingReference><cac:InvoiceDocumentReference><cbc:ID>FE-invoice</cbc:ID><cbc:UUID schemeName="CUFE-SHA384">{key('invoice')}</cbc:UUID><cbc:IssueDate>2026-10-13</cbc:IssueDate></cac:InvoiceDocumentReference></cac:BillingReference>'''
    return f'''<?xml version="1.0" encoding="{encoding}"?>
<{root} xmlns="urn:oasis:names:specification:ubl:schema:xsd:{root}-2" xmlns:cac="{CAC}" xmlns:cbc="{CBC}">
  <cbc:UBLVersionID>2.1</cbc:UBLVersionID><cbc:CustomizationID>{customization}</cbc:CustomizationID><cbc:ProfileID>{profile}</cbc:ProfileID><cbc:ProfileExecutionID>{environment}</cbc:ProfileExecutionID>
  <cbc:ID>{prefix}-{label}</cbc:ID><cbc:UUID schemeID="{environment}" schemeName="{scheme_key}">{key(label)}</cbc:UUID>
  <cbc:IssueDate>2026-10-13</cbc:IssueDate><cbc:IssueTime>12:34:00-05:00</cbc:IssueTime>{type_element}<cbc:Note>DOCUMENTO SINTÉTICO SIN VALIDEZ FISCAL NI FIRMA</cbc:Note><cbc:DocumentCurrencyCode>COP</cbc:DocumentCurrencyCode>
  {reference}
  {party('AccountingSupplierParty', ISSUER, 'Proveedor Sintético Café SAS')}
  {party('AccountingCustomerParty', receiver, 'Comprador Sintético Bogotá SAS', scheme, digit)}
  <cac:PaymentMeans><cbc:ID>1</cbc:ID><cbc:PaymentMeansCode>10</cbc:PaymentMeansCode></cac:PaymentMeans>
  {tax}
  <cac:{total}><cbc:LineExtensionAmount currencyID="COP">100000.00</cbc:LineExtensionAmount><cbc:TaxExclusiveAmount currencyID="COP">100000.00</cbc:TaxExclusiveAmount><cbc:TaxInclusiveAmount currencyID="COP">119000.00</cbc:TaxInclusiveAmount><cbc:PayableAmount currencyID="COP">119000.00</cbc:PayableAmount></cac:{total}>
  <cac:{line}><cbc:ID>1</cbc:ID><cbc:{qty} unitCode="NIU">2</cbc:{qty}><cbc:LineExtensionAmount currencyID="COP">100000.00</cbc:LineExtensionAmount>{tax}<cac:Item><cbc:Description>Café de prueba, lote ficticio</cbc:Description></cac:Item><cac:Price><cbc:PriceAmount currencyID="COP">50000.00</cbc:PriceAmount><cbc:BaseQuantity unitCode="NIU">1</cbc:BaseQuantity></cac:Price></cac:{line}>
</{root}>
'''


def response(label='invoice', reference_key=None):
    prefix = {'credit-note': 'NC', 'debit-note': 'ND'}.get(label, 'FE')
    return f'''<?xml version="1.0" encoding="UTF-8"?>
<ApplicationResponse xmlns="urn:oasis:names:specification:ubl:schema:xsd:ApplicationResponse-2" xmlns:cac="{CAC}" xmlns:cbc="{CBC}"><cbc:UBLVersionID>2.1</cbc:UBLVersionID><cbc:ProfileExecutionID>1</cbc:ProfileExecutionID><cbc:ID>AR-{label}</cbc:ID><cbc:IssueDate>2026-10-13</cbc:IssueDate><cbc:IssueTime>12:34:01-05:00</cbc:IssueTime><cbc:Note>CONSTANCIA SINTÉTICA, NO ES RESPUESTA AUTÉNTICA DIAN</cbc:Note><cac:DocumentResponse><cac:Response><cbc:ResponseCode>00</cbc:ResponseCode><cbc:Description>Documento validado (texto sintético no verificado)</cbc:Description></cac:Response><cac:DocumentReference><cbc:ID>{prefix}-{label}</cbc:ID><cbc:UUID>{reference_key or key(label)}</cbc:UUID></cac:DocumentReference></cac:DocumentResponse></ApplicationResponse>'''


def attached(xml, label='invoice', ar=True):
    root = ET.fromstring(xml)
    doc_key = root.find(f'{{{CBC}}}UUID')
    env = root.findtext(f'{{{CBC}}}ProfileExecutionID')
    number = root.findtext(f'{{{CBC}}}ID')
    ref = '' if not ar else f'''<cac:ParentDocumentLineReference><cbc:LineID>1</cbc:LineID><cac:DocumentReference><cbc:ID>AR-{label}</cbc:ID><cbc:UUID>{key(label)}</cbc:UUID><cac:Attachment><cac:ExternalReference><cbc:MimeCode>text/xml</cbc:MimeCode><cbc:EncodingCode>UTF-8</cbc:EncodingCode><cbc:Description><![CDATA[{response(label)}]]></cbc:Description></cac:ExternalReference></cac:Attachment></cac:DocumentReference></cac:ParentDocumentLineReference>'''
    return f'''<?xml version="1.0" encoding="UTF-8"?>
<AttachedDocument xmlns="urn:oasis:names:specification:ubl:schema:xsd:AttachedDocument-2" xmlns:cac="{CAC}" xmlns:cbc="{CBC}"><cbc:UBLVersionID>2.1</cbc:UBLVersionID><cbc:CustomizationID>Documentos adjuntos</cbc:CustomizationID><cbc:ProfileID>Factura Electrónica de Venta</cbc:ProfileID><cbc:ProfileExecutionID>{env}</cbc:ProfileExecutionID><cbc:ID>AD-{number}</cbc:ID><cbc:UUID schemeID="{env}" schemeName="{doc_key.attrib['schemeName']}">{doc_key.text}</cbc:UUID><cbc:IssueDate>2026-10-13</cbc:IssueDate><cbc:DocumentType>Contenedor de Factura Electrónica</cbc:DocumentType><cbc:ParentDocumentID>{number}</cbc:ParentDocumentID>{party('SenderParty', ISSUER, 'Proveedor Sintético Café SAS')}{party('ReceiverParty', NIT, 'Comprador Sintético Bogotá SAS')}<cac:Attachment><cac:ExternalReference><cbc:MimeCode>text/xml</cbc:MimeCode><cbc:EncodingCode>UTF-8</cbc:EncodingCode><cbc:Description><![CDATA[{xml}]]></cbc:Description></cac:ExternalReference></cac:Attachment>{ref}</AttachedDocument>'''


def pdf():
    stream = b'BT /F1 16 Tf 50 750 Td (SYNTHETIC INVOICE - NOT FISCAL) Tj ET\n'
    objects = [b'<< /Type /Catalog /Pages 2 0 R >>', b'<< /Type /Pages /Kids [3 0 R] /Count 1 >>', b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>', b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', b'<< /Length ' + str(len(stream)).encode() + b' >>\nstream\n' + stream + b'endstream']
    out = bytearray(b'%PDF-1.4\n')
    offsets = [0]
    for index, obj in enumerate(objects, 1):
        offsets.append(len(out))
        out.extend(str(index).encode() + b' 0 obj\n' + obj + b'\nendobj\n')
    start = len(out)
    out.extend(b'xref\n0 6\n0000000000 65535 f \n')
    for offset in offsets[1:]:
        out.extend(f'{offset:010d} 00000 n \n'.encode())
    out.extend(f'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n{start}\n%%EOF\n'.encode())
    return bytes(out)


def archive(entries, compressed=False):
    output = io.BytesIO()
    with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_DEFLATED if compressed else zipfile.ZIP_STORED) as z:
        for name, content in entries:
            info = zipfile.ZipInfo(name, date_time=(2026, 10, 13, 12, 34, 0))
            info.compress_type = zipfile.ZIP_DEFLATED if compressed else zipfile.ZIP_STORED
            info.create_system = 3
            info.external_attr = 0o100600 << 16
            z.writestr(info, content)
    return output.getvalue()


def mail(label, attachments=(), body='Factura sintética adjunta para pruebas locales.', sender='proveedor@example.invalid', subject=None):
    message = EmailMessage(policy=policy.SMTP)
    message['From'] = sender
    message['To'] = ALIAS
    message['Date'] = 'Tue, 13 Oct 2026 12:34:00 -0500'
    message['Message-ID'] = f'<synthetic-{label}@example.invalid>'
    message['Subject'] = subject or f'{ISSUER};Proveedor Sintético Café SAS;FE-{label};01;119000.00'
    message.set_content(body)
    for name, content, mime, disposition in attachments:
        major, minor = mime.split('/', 1)
        if mime == 'message/rfc822':
            # Preserve the RFC822 message structure rather than base64-wrapping it.
            inner = BytesParser(policy=policy.SMTP).parsebytes(content)
            message.add_attachment(inner, filename=name, disposition=disposition)
        else:
            message.add_attachment(content, maintype=major, subtype=minor, filename=name, disposition=disposition)
    if message.is_multipart():
        message.set_boundary('synthetic-boundary-' + label)
    return message.as_bytes()


def ses(label='invoice', sender='proveedor@example.invalid', auth='PASS', virus='PASS', spam='PASS'):
    return {'notificationType': 'Received', 'mail': {'timestamp': TIMESTAMP, 'source': sender, 'messageId': 'synthetic-ses-' + label, 'destination': ['untrusted-to@example.invalid'], 'headersTruncated': False, 'headers': [{'name': 'From', 'value': sender}, {'name': 'To', 'value': 'untrusted-to@example.invalid'}], 'commonHeaders': {'from': [sender], 'to': ['untrusted-to@example.invalid'], 'messageId': '<synthetic-' + label + '@example.invalid>', 'subject': 'Synthetic fixture'}}, 'receipt': {'timestamp': TIMESTAMP, 'processingTimeMillis': 10, 'recipients': [ALIAS], 'spamVerdict': {'status': spam}, 'virusVerdict': {'status': virus}, 'spfVerdict': {'status': auth}, 'dkimVerdict': {'status': auth}, 'dmarcVerdict': {'status': auth}, 'action': {'type': 'S3', 'topicArn': TOPIC, 'bucketName': BUCKET, 'objectKey': 'raw/synthetic-ses-' + label}}}


def wrap(metadata):
    # The SQS Body is this SNS Notification JSON (RawMessageDelivery=false).
    return {'Type': 'Notification', 'MessageId': '11111111-2222-4333-8444-555555555555', 'TopicArn': TOPIC, 'Timestamp': TIMESTAMP, 'Message': json.dumps(metadata, separators=(',', ':'), ensure_ascii=False), 'SignatureVersion': '1', 'Signature': 'SYNTHETIC_NOT_A_VALID_SIGNATURE', 'SigningCertURL': 'https://sns.us-east-1.amazonaws.com/SimpleNotificationService-SYNTHETIC.pem', 'UnsubscribeURL': 'https://example.invalid/disabled'}


def json_fixture(name, data, outcome, **extra):
    return add(name, json.dumps(data, indent=2, ensure_ascii=False) + '\n', outcome, **extra)


def generate():
    ok = {'action': 'ingest_for_review', 'dian': 'not_checked', 'signature': 'not_verified'}
    for label, root, code in [('invoice', 'Invoice', '01'), ('credit-note', 'CreditNote', '91'), ('debit-note', 'DebitNote', '92')]:
        xml = add(label + '.xml', business(label, root, code), {**ok, 'document_type': root, 'document_code': code}, document_key=key(label), receiver={'type': '31', 'number': NIT, 'dv': dv(NIT)})
        ad = add(label + '.attached.xml', attached(xml.decode(), label), {**ok, 'application_response': 'included_not_verified'}, document_key=key(label))
        add(label + '.application-response.xml', response(label), {'action': 'evidence_only', 'authenticated': False}, document_key=key(label))
        if label == 'invoice':
            add('invoice.pdf', pdf(), {'action': 'representation_only'})
            payload = add('invoice.zip', archive([('invoice.attached.xml', ad), ('invoice.pdf', DATA['invoice.pdf'])]), {**ok, 'documents': 1, 'originals': ['zip', 'attached_document', 'commercial_xml', 'application_response', 'pdf']})
            att = ('invoice.zip', payload, 'application/zip', 'attachment')
        else:
            att = (label + '.xml', ad, 'application/xml', 'attachment')
        add(label + '.eml', mail(label, [att]), {**ok, 'documents': 1}, ses_metadata='ses-s3-notification.json' if label == 'invoice' else None)
    variants = [
        ('bom-utf8.xml', {}, None, b'\xef\xbb\xbf'),
        ('latin1.xml', {'encoding': 'ISO-8859-1'}, None, b''),
        ('conflicting-encoding.xml', {'encoding': 'ISO-8859-1'}, 'UNSUPPORTED_ENCODING', b'\xef\xbb\xbf'),
        ('profile-execution-2.xml', {'environment': '2'}, 'TEST_DOCUMENT', b''),
        ('pos-20.xml', {'code': '20'}, None, b''),
        ('support-05.xml', {'code': '05'}, 'SUPPORT_DOCUMENT_NOT_RECEIVABLE', b''),
        ('final-consumer.xml', {'receiver': '222222222222', 'scheme': '13'}, 'FINAL_CONSUMER', b''),
        ('receiver-nit-schemeid.xml', {}, None, b''),
        ('receiver-nit-appended-dv.xml', {'receiver': NIT + dv(NIT), 'digit': ''}, None, b''),
        ('receiver-nit-hyphen-dv.xml', {'receiver': NIT + '-' + dv(NIT), 'digit': ''}, None, b''),
        ('receiver-cc-13.xml', {'receiver': CC, 'scheme': '13'}, None, b''),
        ('receiver-mismatch.xml', {'receiver': '901999001'}, 'RECEIVER_MISMATCH', b''),
    ]
    for name, options, reason, bom in variants:
        label = name[:-4]
        text = business(label, **options)
        encoding = 'latin1' if name == 'latin1.xml' else 'utf-8'
        expected = {'action': 'not_processed', 'reason_code': reason} if reason else dict(ok)
        if name == 'receiver-nit-appended-dv.xml':
            expected['warnings'] = ['RECEIVER_DV_ATTACHED']
        if name == 'receiver-cc-13.xml':
            expected['expected_identity'] = {'type': '13', 'number': CC}
            expected['with_nit_authority'] = 'RECEIVER_MISMATCH'
        if name == 'pos-20.xml':
            expected.update({'document_code': '20', 'key_scheme': 'CUDE-SHA384', 'buyer_events_allowed': False})
        add(name, bom + text.encode(encoding), expected, encoding=encoding, document_key=key(label))
    for code in ['01', '02', '03', '04']:
        add('invoice-type-' + code + '.xml', business('invoice-type-' + code, code=code), {**ok, 'document_code': code})
    no_ar = add('attached-without-application-response.xml', attached(DATA['invoice.xml'].decode(), ar=False), {**ok, 'warnings': ['No incluye constancia de validación DIAN']})
    add('application-response-mismatched.xml', response(reference_key=key('unrelated-document')), {'action': 'evidence_only', 'authenticated': False, 'warning': 'reference_mismatch'})
    add('pdf-only.zip', archive([('invoice.pdf', DATA['invoice.pdf'])]), {'action': 'not_processed', 'reason_code': 'MISSING_FISCAL_XML'})
    add('principal-double.zip', archive([('principal.zip', DATA['invoice.zip'])]), {**ok, 'zip_depth': 1, 'documents': 1})
    complement = archive([('../not-to-extract.txt', b'SAFE SYNTHETIC TEXT, NOT MALWARE')])
    add('invoice-with-complement.zip', archive([('invoice.attached.xml', DATA['invoice.attached.xml']), ('complement.zip', complement)]), {**ok, 'warnings': ['Archivo complementario guardado sin abrir'], 'complement_must_not_expand': True})
    add('outlook-forward-as-attachment.eml', mail('outlook-forward', [('Factura.eml', DATA['invoice.eml'], 'message/rfc822', 'attachment')], body='Reenvío como datos adjuntos desde Outlook (sintético).'), {**ok, 'nested_messages': 1, 'documents': 1})
    add('gmail-multi-forward.eml', mail('gmail-multi-forward', [(label + '.eml', DATA[label + '.eml'], 'message/rfc822', 'attachment') for label in ['invoice', 'credit-note', 'debit-note']], body='---------- Forwarded messages ----------\nHistórico sintético Gmail.'), {**ok, 'nested_messages': 3, 'documents': 3})
    add('inline-zip.eml', mail('inline-zip', [('FACTURA.ZIP', DATA['invoice.zip'], 'application/octet-stream', 'inline')]), {**ok, 'documents': 1, 'classification': 'content_magic'})
    add('generic-mime-xml.eml', mail('generic-mime-xml', [('document.bin', DATA['invoice.attached.xml'], 'application/octet-stream', 'inline')]), {**ok, 'documents': 1, 'classification': 'content_magic'})
    add('provider-link.eml', mail('provider-link', body='Descarga sintética desactivada: https://example.invalid/factura/FE-1'), {'action': 'not_processed', 'reason_code': 'PROVIDER_SENT_LINK', 'network_calls': 0})
    add('winmail.eml', mail('winmail', [('winmail.dat', b'\x78\x9f\x3e\x22\x00\x00SYNTHETIC_TNEF', 'application/ms-tnef', 'attachment')]), {'action': 'not_processed', 'reason_code': 'TNEF_UNSUPPORTED'})
    add('unsupported-archive.eml', mail('unsupported-archive', [('factura.rar', b'Rar!\x1a\x07\x00SYNTHETIC', 'application/octet-stream', 'attachment')]), {'action': 'not_processed', 'reason_code': 'ARCHIVE_FORMAT_UNSUPPORTED'})
    add('partial-batch.eml', mail('partial-batch', [('invoice.xml', DATA['invoice.attached.xml'], 'application/xml', 'attachment'), ('wrong-receiver.xml', DATA['receiver-mismatch.xml'], 'application/xml', 'attachment')]), {**ok, 'message_status': 'partial', 'documents': 1, 'rejected_part_reason': 'RECEIVER_MISMATCH'})
    add('non-invoice.eml', mail('non-invoice', body='Publicidad sintética sin adjuntos ni enlaces.'), {'action': 'ignored', 'reason_code': 'NOT_AN_INVOICE'})
    challenge = f'You have requested to automatically forward mail to {ALIAS}.\nConfirmation code: 123456789\nDo not use this synthetic code with Google. No confirmation URL is provided.\n'
    add('gmail-forwarding-confirmation.eml', mail('gmail-confirmation', body=challenge, sender='forwarding-noreply@google.com', subject=f'Gmail Forwarding Confirmation - Receive Mail from proveedor@example.invalid'), {'action': 'gmail_code_only', 'code': '123456789', 'documents': 0, 'expires_within_hours': 24, 'requires_authoritative_metadata': True}, ses_metadata='gmail-forwarding-confirmation.ses.json')
    json_fixture('gmail-forwarding-confirmation.ses.json', ses('gmail-confirmation', sender='forwarding-noreply@google.com'), {'action': 'gmail_challenge_authenticated_in_simulation', 'auth_evidence_is_synthetic': True})
    add('gmail-forwarding-spoof.eml', mail('gmail-spoof', body=challenge, sender='forwarding-noreply@google.com', subject='Gmail Forwarding Confirmation'), {'action': 'ignore_code', 'documents': 0, 'reason': 'untrusted_spf_dkim_dmarc'}, ses_metadata='gmail-forwarding-spoof.ses.json')
    json_fixture('gmail-forwarding-spoof.ses.json', ses('gmail-spoof', sender='attacker@example.invalid', auth='FAIL'), {'action': 'no_gmail_code', 'authenticated': False})
    add('gmail-forwarding-link-only.eml', mail('gmail-link-only', body='Synthetic link-only confirmation. URL deliberately disabled: https://example.invalid/confirm\nNo numeric code exists in this message.', sender='forwarding-noreply@google.com', subject='Gmail Forwarding Confirmation'), {'action': 'gmail_no_code_fallback', 'network_calls': 0, 'documents': 0})
    notification = wrap(ses())
    json_fixture('ses-s3-notification.json', notification, {'action': 'resolve_receipt_recipients_only', 'mime_fixture': 'invoice.eml', 'bucket': BUCKET, 'key': 'raw/synthetic-ses-invoice'})
    duplicate = copy.deepcopy(notification)
    duplicate['MessageId'] = '66666666-7777-4888-8999-000000000000'
    json_fixture('ses-s3-notification-duplicate.json', duplicate, {'action': 'transport_duplicate', 'same_ses_message_alias': True, 'additional_quota': 0})
    cross = copy.deepcopy(notification)
    cross['TopicArn'] = TOPIC.replace('-prod', '-stg')
    cross_msg = json.loads(cross['Message'])
    cross_msg['receipt']['action']['topicArn'] = cross['TopicArn']
    cross_msg['receipt']['action']['bucketName'] = BUCKET.replace('-prod', '-stg')
    cross_msg['receipt']['action']['objectKey'] = 'raw/../../foreign-key'
    cross['Message'] = json.dumps(cross_msg)
    json_fixture('ses-cross-environment.json', cross, {'action': 'reject_before_get_object', 'get_object_calls': 0})
    for label, virus, spam in [('virus-fail', 'FAIL', 'PASS'), ('virus-gray', 'GRAY', 'PASS'), ('virus-error', 'PROCESSING_FAILED', 'PASS'), ('spam-fail', 'PASS', 'FAIL')]:
        json_fixture('ses-' + label + '.json', wrap(ses(label, virus=virus, spam=spam)), {'action': 'do_not_process', 'documents': 0, 'reason_code': 'VIRUS_BLOCKED' if virus == 'FAIL' else 'SUSPICIOUS_EMAIL' if spam == 'FAIL' else 'SECURITY_SCAN_UNAVAILABLE'})
    # Deliberately tiny attacks; never decompress to disk or use real malware.
    add('zip-traversal.zip', archive([('../escape.xml', DATA['invoice.xml'])]), {'action': 'reject_archive', 'reason_code': 'CORRUPT_OR_ENCRYPTED_FILE'})
    add('zip-collision.zip', archive([('same.xml', DATA['invoice.xml']), ('dir/../same.xml', DATA['invoice.xml'])]), {'action': 'reject_archive', 'reason_code': 'CORRUPT_OR_ENCRYPTED_FILE'})
    corrupt = bytearray(archive([('invoice.xml', DATA['invoice.xml'])]))
    # Stored ZIP content changed without altering either CRC field.
    content_offset = 30 + struct.unpack_from('<H', corrupt, 26)[0] + struct.unpack_from('<H', corrupt, 28)[0]
    corrupt[content_offset + 1] ^= 1
    add('zip-crc-invalid.zip', bytes(corrupt), {'action': 'reject_archive', 'reason_code': 'CORRUPT_OR_ENCRYPTED_FILE'})
    flagged = bytearray(archive([('invoice.xml', DATA['invoice.xml'])]))
    central = flagged.index(b'PK\x01\x02')
    struct.pack_into('<H', flagged, 6, 1)
    struct.pack_into('<H', flagged, central + 8, 1)
    add('zip-encrypted-flag.zip', bytes(flagged), {'action': 'reject_archive_before_inflate', 'reason_code': 'CORRUPT_OR_ENCRYPTED_FILE'}, note='Encryption flag only, not a real encrypted archive or password.')
    symlink = bytearray(archive([('link.xml', b'../target.xml')]))
    central = symlink.index(b'PK\x01\x02')
    struct.pack_into('<I', symlink, central + 38, 0o120777 << 16)
    add('zip-symlink.zip', bytes(symlink), {'action': 'reject_archive', 'reason_code': 'CORRUPT_OR_ENCRYPTED_FILE'})
    add('zip-ratio-limit.zip', archive([('small.txt', b'A' * 16384)], compressed=True), {'action': 'reject_archive', 'reason_code': 'LIMIT_EXCEEDED'}, test_limits={'max_ratio': 100}, note='16 KiB expanded, no giant bomb.')
    add('zip-inflated-budget.zip', archive([('one.txt', b'A' * 128), ('two.txt', b'B' * 128)]), {'action': 'reject_archive', 'reason_code': 'LIMIT_EXCEEDED'}, test_limits={'max_inflated_bytes': 200})
    add('zip-entry-limit.zip', archive([(f'{i}.txt', b'x') for i in range(3)]), {'action': 'reject_archive', 'reason_code': 'LIMIT_EXCEEDED'}, test_limits={'max_entries': 2})
    add('xml-xxe.xml', '<?xml version="1.0"?><!DOCTYPE Invoice [<!ENTITY external SYSTEM "https://example.invalid/do-not-fetch">]><Invoice>&external;</Invoice>', {'action': 'not_processed', 'reason_code': 'INVALID_FISCAL_XML', 'network_calls': 0})
    add('eml-depth-2.eml', mail('depth-2', [('inner.eml', DATA['outlook-forward-as-attachment.eml'], 'message/rfc822', 'attachment')]), {'action': 'not_processed', 'reason_code': 'NESTING_LIMIT_EXCEEDED'})
    manifest = {'schema_version': 1, 'provenance': '100% synthetic; no original or anonymized customer email', 'generated_at': TIMESTAMP, 'generator': 'generate-fixtures.py', 'source_sample_directory': '~/Documents/Organizations/Quickss/Files/fixtures-recepcion-correo/', 'real_samples_available': False, 'anonymized_fields': [], 'invented_fields': ['NIT/CC, legal names, amounts, document identifiers, unique codes, dates, email headers/body, Gmail code, SES verdicts/IDs, account, bucket, topic'], 'limitations': ['No DIAN XSD/signature/cryptographic verification claimed.', '96hex keys are SHA384 of fixture labels, not genuine CUFE/CUDE.', 'Gmail template and metadata are synthetic, not proven against a live Google delivery.', 'SES PASS/FAIL are test inputs, not real scan or sender authentication.', 'Expected outcomes are approved contracts, not observed application test results.'], 'constants': {'receiver_nit': NIT, 'receiver_dv': dv(NIT), 'issuer_nit': ISSUER, 'issuer_dv': dv(ISSUER), 'receiver_cc': CC, 'alias': ALIAS, 'topic_arn': TOPIC, 'bucket': BUCKET, 'environment': 'production', 'raw_prefix': 'raw/'}, 'files': ENTRIES}
    for name, content in DATA.items():
        (ROOT / name).write_bytes(content)
    (ROOT / 'manifest.json').write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    print(f'Generated {len(ENTRIES)} synthetic fixtures + manifest. No external verification claimed.')


def verify():
    manifest = json.loads((ROOT / 'manifest.json').read_text())
    assert manifest['real_samples_available'] is False
    assert manifest['constants']['receiver_dv'] == dv(NIT)
    assert manifest['constants']['issuer_dv'] == dv(ISSUER)
    for entry in manifest['files']:
        raw = (ROOT / entry['path']).read_bytes()
        assert len(raw) == entry['bytes'], entry['path']
        assert hashlib.sha256(raw).hexdigest() == entry['sha256'], entry['path']
        assert len(raw) < 100000, 'Fixtures must stay small'
        if entry['path'].endswith('.xml') and entry['path'] not in ['conflicting-encoding.xml', 'xml-xxe.xml']:
            root = ET.fromstring(raw)
            for node in root.iter(f'{{{CBC}}}Description'):
                if (node.text or '').lstrip().startswith('<?xml'):
                    ET.fromstring(node.text)
            for node in root.iter(f'{{{CBC}}}UUID'):
                assert len(node.text) == 96 and all(c in '0123456789abcdef' for c in node.text)
        if entry['path'].endswith('.eml'):
            message = BytesParser(policy=policy.default).parsebytes(raw)
            assert message['From'] and message['To'] and message['Message-ID']
            assert not message.defects, (entry['path'], message.defects)
        if entry['path'].endswith('.zip') and entry['path'] not in ['zip-crc-invalid.zip', 'zip-encrypted-flag.zip']:
            with zipfile.ZipFile(io.BytesIO(raw)) as z:
                assert z.testzip() is None, entry['path']
    with zipfile.ZipFile(ROOT / 'zip-crc-invalid.zip') as z:
        assert z.testzip() == 'invoice.xml'
    with zipfile.ZipFile(ROOT / 'zip-encrypted-flag.zip') as z:
        assert z.infolist()[0].flag_bits & 1
    invoice = json.loads((ROOT / 'ses-s3-notification.json').read_text())
    duplicate = json.loads((ROOT / 'ses-s3-notification-duplicate.json').read_text())
    assert invoice['Message'] == duplicate['Message'] and invoice['MessageId'] != duplicate['MessageId']
    metadata = json.loads(invoice['Message'])
    assert metadata['receipt']['recipients'] == [ALIAS]
    assert metadata['mail']['destination'] != [ALIAS]
    confirmation = json.loads((ROOT / 'gmail-forwarding-confirmation.ses.json').read_text())
    spoof = json.loads((ROOT / 'gmail-forwarding-spoof.ses.json').read_text())
    assert confirmation['receipt']['dkimVerdict']['status'] == 'PASS'
    assert spoof['receipt']['dkimVerdict']['status'] == 'FAIL'
    latin1 = (ROOT / 'latin1.xml').read_bytes().decode('latin1')
    assert 'Proveedor Sintético Café SAS' in latin1 and 'Café de prueba' in latin1
    assert (ROOT / 'bom-utf8.xml').read_bytes().startswith(b'\xef\xbb\xbf')
    assert (ROOT / 'conflicting-encoding.xml').read_bytes().startswith(b'\xef\xbb\xbf')
    print(f'PASS corpus integrity: {len(manifest["files"])} fixtures, SHA256/bytes, UBL XML/CDATA, MIME, ZIP CRC/flags, NIT DV, SES duplicate/RCPT, UTF8 BOM/Latin1. NOT an ingestion or DIAN test.')


if __name__ == '__main__':
    if sys.argv[1:] == ['--verify']:
        verify()
    elif not sys.argv[1:]:
        generate()
    else:
        raise SystemExit('Usage: generate-fixtures.py [--verify]')

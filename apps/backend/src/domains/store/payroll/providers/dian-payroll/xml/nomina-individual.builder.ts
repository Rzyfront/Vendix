import { create } from 'xmlbuilder2';
import {
  NOMINA_NAMESPACE,
  DSPNE_VERSION,
  CONTRACT_TYPE_MAP,
  DOCUMENT_TYPE_MAP,
  TIPO_XML,
  DEFAULT_COUNTRY_CODE,
  DEFAULT_LANGUAGE,
  DEFAULT_CURRENCY,
} from '../constants/nomina-codes';
import { CuneCalculator } from '../cune-calculator';
import { NominaDocumentData } from '../interfaces/nomina-data.interface';

/**
 * Builds NominaIndividual XML documents compliant with DIAN DSPNE specification.
 *
 * IMPORTANT: DSPNE uses XML ATTRIBUTES (not child text nodes).
 * Example: <Basico DiasTrabajados="30" SueldoTrabajado="1423500.00"/>
 *
 * All monetary amounts use 2 decimal places.
 * All dates use YYYY-MM-DD format.
 * Boolean attributes use "true"/"false" strings.
 */
export class NominaIndividualBuilder {
  /**
   * Builds the complete NominaIndividual XML and computes the CUNE.
   *
   * @returns Object with the XML string and computed CUNE hash.
   */
  static build(
    data: NominaDocumentData,
    config: {
      software_id: string;
      software_pin: string;
      nit: string;
      nit_dv: string;
      environment: '1' | '2';
    },
  ): { xml: string; cune: string } {
    const issue_date = data.period.generation_date;
    const issue_time = NominaIndividualBuilder.formatIssueTime();

    const document_number = `${data.prefix}${data.consecutive}`;

    // Calculate SoftwareSC
    const software_sc = CuneCalculator.generateSoftwareSecurityCode(
      config.software_id,
      config.software_pin,
      document_number,
    );

    // Calculate CUNE
    const cune = CuneCalculator.generate({
      document_number,
      issue_date,
      issue_time,
      total_earnings: data.total_earnings,
      total_deductions: data.total_deductions,
      total_amount: data.net_amount,
      issuer_nit: config.nit,
      employee_document: data.worker.document_number,
      document_type: TIPO_XML.NOMINA_INDIVIDUAL,
      software_pin: config.software_pin,
      environment: config.environment,
    });

    // Build QR code URL
    const qr_url = `https://catalogo-vpfe.dian.gov.co/document/searchqr?documentkey=${cune}`;

    // Build XML document
    const doc = create({ version: '1.0', encoding: 'UTF-8' });

    const root = doc.ele(NOMINA_NAMESPACE, 'NominaIndividual');

    // --- Periodo ---
    root.ele('Periodo').att({
      FechaIngreso: data.period.hire_date,
      FechaLiquidacionInicio: data.period.settlement_start,
      FechaLiquidacionFin: data.period.settlement_end,
      TiempoLaborado: data.period.worked_time,
      FechaGen: data.period.generation_date,
    });

    // --- NumeroSecuenciaXML ---
    root.ele('NumeroSecuenciaXML').att({
      Prefijo: data.prefix,
      Consecutivo: data.consecutive,
    });

    // --- LugarGeneracionXML ---
    root.ele('LugarGeneracionXML').att({
      Pais: data.location.country,
      DepartamentoEstado: data.location.department,
      MunicipioCiudad: data.location.city,
      Idioma: data.location.language,
    });

    // --- ProveedorXML ---
    root.ele('ProveedorXML').att({
      NIT: config.nit,
      DV: config.nit_dv,
      SoftwareID: config.software_id,
      SoftwareSC: software_sc,
    });

    // --- CodigoQR ---
    root.ele('CodigoQR').txt(qr_url);

    // --- InformacionGeneral ---
    root.ele('InformacionGeneral').att({
      Version: DSPNE_VERSION,
      Ambiente: config.environment,
      TipoXML: String(TIPO_XML.NOMINA_INDIVIDUAL),
      CUNE: cune,
      EncripCUNE: 'SHA-384',
      FechaGen: issue_date,
      HoraGen: issue_time,
      PeriodoNomina: data.payroll_period,
      TipoMoneda: DEFAULT_CURRENCY,
    });

    // --- Empleador ---
    root.ele('Empleador').att({
      NIT: data.employer.nit,
      DV: data.employer.dv,
      Pais: data.employer.country,
      DepartamentoEstado: data.employer.department,
      MunicipioCiudad: data.employer.city,
      Direccion: data.employer.address,
      RazonSocial: data.employer.legal_name,
    });

    // --- Trabajador ---
    const worker_attrs: Record<string, string> = {
      TipoTrabajador: data.worker.worker_type,
      SubTipoTrabajador: data.worker.sub_type,
      AltoRiesgoPension: data.worker.high_risk_pension ? 'true' : 'false',
      TipoDocumento: data.worker.document_type,
      NumeroDocumento: data.worker.document_number,
      PrimerApellido: data.worker.last_name,
      PrimerNombre: data.worker.first_name,
      LugarTrabajoPais: data.worker.work_country,
      LugarTrabajoDepartamentoEstado: data.worker.work_department,
      LugarTrabajoMunicipioCiudad: data.worker.work_city,
      LugarTrabajoDireccion: data.worker.work_address,
      SalarioIntegral: data.worker.integral_salary ? 'true' : 'false',
      TipoContrato: data.worker.contract_type,
      Sueldo: data.worker.salary.toFixed(2),
      CodigoTrabajador: data.worker.employee_code,
      FechaIngreso: data.worker.hire_date,
    };

    if (data.worker.second_last_name) {
      worker_attrs.SegundoApellido = data.worker.second_last_name;
    }
    if (data.worker.other_names) {
      worker_attrs.OtrosNombres = data.worker.other_names;
    }
    if (data.worker.termination_date) {
      worker_attrs.FechaRetiro = data.worker.termination_date;
    }

    root.ele('Trabajador').att(worker_attrs);

    // --- Pago ---
    root.ele('Pago').att({
      Forma: data.payment.form,
      Metodo: data.payment.method,
    });

    // --- FechasPagos ---
    const fechas_pagos = root.ele('FechasPagos');
    for (const payment_date of data.payment.payment_dates) {
      fechas_pagos.ele('FechaPago').att({ FechaPago: payment_date });
    }

    // --- Devengados ---
    NominaIndividualBuilder.buildDevengados(root, data);

    // --- Deducciones ---
    NominaIndividualBuilder.buildDeducciones(root, data);

    // --- Totals ---
    root.ele('DevengadosTotal').txt(data.total_earnings.toFixed(2));
    root.ele('DeduccionesTotal').txt(data.total_deductions.toFixed(2));
    root.ele('ComprobanteTotal').txt(data.net_amount.toFixed(2));

    return {
      xml: doc.end({ prettyPrint: true }),
      cune,
    };
  }

  /**
   * Builds the <Devengados> section with all earnings sub-elements.
   */
  private static buildDevengados(
    root: any,
    data: NominaDocumentData,
  ): void {
    const devengados = root.ele('Devengados');
    const earnings = data.earnings;

    // Basico (required)
    devengados.ele('Basico').att({
      DiasTrabajados: String(earnings.worked_days),
      SueldoTrabajado: earnings.base_salary.toFixed(2),
    });

    // Transporte (optional)
    if (
      earnings.transport_subsidy ||
      earnings.travel_allowance_taxable ||
      earnings.travel_allowance_non_taxable
    ) {
      const transport_attrs: Record<string, string> = {};
      if (earnings.transport_subsidy != null) {
        transport_attrs.AuxilioTransporte =
          earnings.transport_subsidy.toFixed(2);
      }
      if (earnings.travel_allowance_taxable != null) {
        transport_attrs.ViaticoManuworAlojS =
          earnings.travel_allowance_taxable.toFixed(2);
      }
      if (earnings.travel_allowance_non_taxable != null) {
        transport_attrs.ViaticoManuworAlojNS =
          earnings.travel_allowance_non_taxable.toFixed(2);
      }
      devengados.ele('Transporte').att(transport_attrs);
    }

    // HorasExtras (optional)
    if (earnings.overtime && earnings.overtime.length > 0) {
      const horas_extras = devengados.ele('HEDs');
      for (const ot of earnings.overtime) {
        horas_extras.ele('HED').att({
          Cantidad: String(ot.hours),
          Porcentaje: ot.percentage.toFixed(2),
          Pago: ot.amount.toFixed(2),
        });
      }
    }

    // Comisiones (optional)
    if (earnings.commissions != null && earnings.commissions > 0) {
      devengados.ele('Comisiones').att({
        Comision: earnings.commissions.toFixed(2),
      });
    }

    // Primas (optional)
    if (earnings.primas) {
      const primas_attrs: Record<string, string> = {
        Cantidad: String(earnings.primas.quantity),
        Pago: earnings.primas.payment.toFixed(2),
      };
      if (earnings.primas.non_taxable_payment != null) {
        primas_attrs.PagoNS =
          earnings.primas.non_taxable_payment.toFixed(2);
      }
      devengados.ele('Primas').att(primas_attrs);
    }

    // Cesantias (optional)
    if (earnings.cesantias) {
      devengados.ele('Cesantias').att({
        Pago: earnings.cesantias.payment.toFixed(2),
        Porcentaje: earnings.cesantias.percentage.toFixed(2),
        PagoIntereses: earnings.cesantias.interest_payment.toFixed(2),
      });
    }

    // Vacaciones (optional)
    if (earnings.vacations && earnings.vacations.length > 0) {
      const vacaciones = devengados.ele('Vacaciones');
      for (const vac of earnings.vacations) {
        vacaciones.ele('VacacionesComunes').att({
          FechaInicio: vac.start_date,
          FechaFin: vac.end_date,
          Cantidad: String(vac.quantity),
          Pago: vac.payment.toFixed(2),
        });
      }
    }

    // Incapacidades (optional)
    if (earnings.disabilities && earnings.disabilities.length > 0) {
      const incapacidades = devengados.ele('Incapacidades');
      for (const dis of earnings.disabilities) {
        incapacidades.ele('Incapacidad').att({
          FechaInicio: dis.start_date,
          FechaFin: dis.end_date,
          Cantidad: String(dis.quantity),
          Tipo: String(dis.type),
          Pago: dis.payment.toFixed(2),
        });
      }
    }

    // Licencias (optional)
    if (earnings.licenses && earnings.licenses.length > 0) {
      const licencias = devengados.ele('Licencias');
      for (const lic of earnings.licenses) {
        licencias.ele('Licencia').att({
          FechaInicio: lic.start_date,
          FechaFin: lic.end_date,
          Cantidad: String(lic.quantity),
          Tipo: lic.type,
          Pago: lic.payment.toFixed(2),
        });
      }
    }

    // Bonificaciones (optional)
    if (earnings.bonuses && earnings.bonuses.length > 0) {
      const bonificaciones = devengados.ele('Bonificaciones');
      for (const bonus of earnings.bonuses) {
        bonificaciones.ele('Bonificacion').att({
          BonificacionS: bonus.taxable.toFixed(2),
          BonificacionNS: bonus.non_taxable.toFixed(2),
        });
      }
    }
  }

  /**
   * Builds the <Deducciones> section with all deduction sub-elements.
   */
  private static buildDeducciones(
    root: any,
    data: NominaDocumentData,
  ): void {
    const deducciones = root.ele('Deducciones');
    const deductions = data.deductions;

    // Salud (required)
    deducciones.ele('Salud').att({
      Porcentaje: deductions.health_pct.toFixed(2),
      Deduccion: deductions.health_amount.toFixed(2),
    });

    // FondoPension (required)
    deducciones.ele('FondoPension').att({
      Porcentaje: deductions.pension_pct.toFixed(2),
      Deduccion: deductions.pension_amount.toFixed(2),
    });

    // FondoSP (optional — solidarity and subsistence funds)
    if (
      deductions.solidarity_fund_amount ||
      deductions.subsistence_fund_amount
    ) {
      const fondo_sp_attrs: Record<string, string> = {};
      if (deductions.solidarity_fund_pct != null) {
        fondo_sp_attrs.Porcentaje =
          deductions.solidarity_fund_pct.toFixed(2);
      }
      if (deductions.solidarity_fund_amount != null) {
        fondo_sp_attrs.DeduccionSP =
          deductions.solidarity_fund_amount.toFixed(2);
      }
      if (deductions.subsistence_fund_pct != null) {
        fondo_sp_attrs.PorcentajeSub =
          deductions.subsistence_fund_pct.toFixed(2);
      }
      if (deductions.subsistence_fund_amount != null) {
        fondo_sp_attrs.DeduccionSub =
          deductions.subsistence_fund_amount.toFixed(2);
      }
      deducciones.ele('FondoSP').att(fondo_sp_attrs);
    }

    // RetencionFuente (optional)
    if (deductions.retention != null && deductions.retention > 0) {
      deducciones.ele('RetencionFuente').att({
        RetencionFuente: deductions.retention.toFixed(2),
      });
    }

    // OtrasDeducciones (optional)
    if (
      deductions.other_deductions &&
      deductions.other_deductions.length > 0
    ) {
      const otras = deducciones.ele('OtrasDeducciones');
      for (const other of deductions.other_deductions) {
        otras.ele('OtraDeduccion').att({
          OtraDeduccion: other.amount.toFixed(2),
        });
      }
    }
  }

  /**
   * Formats the current time in HH:mm:ss-05:00 format (Colombia timezone).
   */
  private static formatIssueTime(): string {
    const now = new Date();
    // Offset to Colombia time (UTC-5)
    const colombia_offset = -5 * 60;
    const utc = now.getTime() + now.getTimezoneOffset() * 60000;
    const colombia_time = new Date(utc + colombia_offset * 60000);

    const hours = String(colombia_time.getHours()).padStart(2, '0');
    const minutes = String(colombia_time.getMinutes()).padStart(2, '0');
    const seconds = String(colombia_time.getSeconds()).padStart(2, '0');

    return `${hours}:${minutes}:${seconds}-05:00`;
  }
}

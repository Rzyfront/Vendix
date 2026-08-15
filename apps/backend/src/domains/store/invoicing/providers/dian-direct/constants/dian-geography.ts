/**
 * Catálogo geográfico DIAN: departamentos (ISO 3166-2:CO) y municipios (DANE),
 * con su código postal urbano de referencia.
 *
 * POR QUÉ EXISTE
 * --------------
 * `UblCommonBuilder.buildAddressFields` rellenaba hoy `Bogotá / 11001 / 110111`
 * cuando no conocía el municipio del cliente. Eso no es un valor por defecto
 * inofensivo: es DECLARAR ANTE LA DIAN un municipio falso en
 * `cbc:ID` + `cbc:CityName` + `cbc:PostalZone` + `cbc:CountrySubentityCode`.
 * La DIAN valida el código contra su lista (reglas FAJ29 / FAJ32 «este código no
 * corresponde a un valor válido de la lista»), así que un municipio inventado
 * pasa la validación de LISTA pero deja el documento fiscalmente mal declarado
 * — y el consecutivo autorizado ya se gastó.
 *
 * Con este catálogo el llamador puede: (a) resolver el municipio real a partir
 * del código o del nombre, y (b) SABER que no lo conoce, en vez de fabricar uno.
 *
 * FUENTES (ambas concuerdan en exactamente 1122 municipios, verificado por
 * intersección de conjuntos — 0 sobrantes por cada lado)
 * ------------------------------------------------------------------------
 * - `Caja_de_herramientas.../Listas de valores/Municipio-2.1.gc`
 *   → columna `code` (DANE 5 dígitos) y `name`. Nombres VERBATIM de la DIAN,
 *     incluidas sus rarezas de mayúsculas (p. ej. `Bogotá, D.c.`). No se
 *     "corrigen": el objetivo es reproducir la lista oficial, no mejorarla.
 * - `Caja_de_herramientas.../Listas de valores/Departamentos-2.1.gc` (33 filas).
 * - `Caja_de_herramientas.../Anexo Tecnico/Codigos_Postales.xlsx`
 *   (3681 filas: departamento, municipio, código postal, tipo Urbano/Rural).
 *   Se toma el código postal URBANO más bajo de cada municipio — criterio
 *   determinista y reproducible. Verificación cruzada: 11001 → `110111`, que es
 *   exactamente el valor que el builder traía cableado para Bogotá.
 * - Anexo Técnico 1.9 (Res. 000165/2023) §13.4.2 Departamentos, §13.4.3
 *   Municipios, §13.4.4 Códigos Postales. En 1.9 estas tablas fueron sacadas del
 *   PDF a `Anexo Tecnico/Tablas Referenciadas`; el ZIP disponible es el de la
 *   v1.8, cuyas tablas geográficas la 1.9 NO modificó (el control de cambios
 *   §2.1 no las lista entre las tablas tocadas).
 *
 * POR QUÉ UNA CADENA DELIMITADA Y NO UN OBJETO NI UN JSON
 * ------------------------------------------------------
 * Tamaños REALES medidos sobre estos mismos 1122 registros:
 *   - objeto literal `{ '05001': { name, department_code, postal_code } }` → 90 066 B
 *   - array de tuplas `['05001','Medellín','05','050001']`                 → 47 430 B
 *   - archivo `.json` aparte                                               → 45 187 B
 *   - cadena delimitada `code|name|postal;…` (este archivo)                → 26 112 B
 *
 * Se eligió la cadena delimitada por tres razones, en este orden:
 *  1. Para `tsc` es UN solo token. Un objeto literal de 1122 claves con `as const`
 *     genera un tipo unión de 1122 miembros y encarece cada chequeo que lo toque.
 *     El código de municipio NO se puede tipar como unión sin pagar ese precio, y
 *     además llega siempre de la base de datos como `string`: la unión no
 *     protegería nada real.
 *  2. Un `.json` aparte exigiría `resolveJsonModule` y que `nest-cli.json` lo
 *     copiara a `dist/`. Es una dependencia de build nueva que puede fallar en
 *     producción y no en desarrollo — coste desproporcionado para 26 KB.
 *  3. El `Map` se construye UNA vez, perezosamente, en el primer acceso.
 *
 * El `department_code` no se almacena: son los 2 primeros dígitos del código
 * DANE del municipio, invariante verificada sobre los 1122 registros.
 */

/** Departamento de Colombia según ISO 3166-2:CO / DANE. */
export interface DianDepartment {
  /** Código de 2 dígitos → `cbc:CountrySubentityCode`. */
  readonly code: string;
  /** Nombre oficial → `cbc:CountrySubentity`. */
  readonly name: string;
}

/** Municipio de Colombia según la lista DANE que la DIAN valida. */
export interface DianMunicipality {
  /** Código DANE de 5 dígitos → `cbc:ID` de la dirección. */
  readonly code: string;
  /** Nombre verbatim de la lista DIAN → `cbc:CityName`. */
  readonly name: string;
  /** Los 2 primeros dígitos del código DANE → `cbc:CountrySubentityCode`. */
  readonly department_code: string;
  /** Nombre del departamento → `cbc:CountrySubentity`. */
  readonly department_name: string;
  /** Código postal urbano de referencia → `cbc:PostalZone`. */
  readonly postal_code: string;
}

/**
 * Departamentos (33). Fuente: `Departamentos-2.1.gc`, columna `code`/`name`.
 * Es la enumeración COMPLETA que acepta `cbc:CountrySubentityCode`.
 */
export const DIAN_DEPARTMENTS = {
  '05': 'Antioquia',
  '08': 'Atlántico',
  '11': 'Bogotá',
  '13': 'Bolívar',
  '15': 'Boyacá',
  '17': 'Caldas',
  '18': 'Caquetá',
  '19': 'Cauca',
  '20': 'Cesar',
  '23': 'Córdoba',
  '25': 'Cundinamarca',
  '27': 'Chocó',
  '41': 'Huila',
  '44': 'La Guajira',
  '47': 'Magdalena',
  '50': 'Meta',
  '52': 'Nariño',
  '54': 'Norte de Santander',
  '63': 'Quindío',
  '66': 'Risaralda',
  '68': 'Santander',
  '70': 'Sucre',
  '73': 'Tolima',
  '76': 'Valle del Cauca',
  '81': 'Arauca',
  '85': 'Casanare',
  '86': 'Putumayo',
  '88': 'San Andrés y Providencia',
  '91': 'Amazonas',
  '94': 'Guainía',
  '95': 'Guaviare',
  '97': 'Vaupés',
  '99': 'Vichada',
} as const satisfies Readonly<Record<string, string>>;

/**
 * Unión de los 33 códigos de departamento. Aquí SÍ vale la pena: son pocos y un
 * departamento fuera de catálogo es un error de programación, no un dato.
 */
export type DianDepartmentCode = keyof typeof DIAN_DEPARTMENTS;

/** `true` si el valor es uno de los 33 códigos de departamento de la DIAN. */
export function isDianDepartmentCode(
  value: unknown,
): value is DianDepartmentCode {
  return (
    typeof value === 'string' &&
    Object.prototype.hasOwnProperty.call(DIAN_DEPARTMENTS, value)
  );
}

/**
 * Municipios serializados como `codigo|nombre|codigoPostal`, separados por `;`,
 * ordenados por código DANE. Ningún nombre de la lista oficial contiene `|` ni
 * `;` (verificado sobre los 1122), así que el delimitador es seguro.
 */
const MUNICIPALITIES_RAW =
  '05001|Medellín|050001;05002|Abejorral|055030;05004|Abriaquí|057460;05021|Alejandría|053820;05030|Amagá|055840;05031|Amalfi|052840;05034|Andes|056060;05036|Angelópolis|055830;05038|Angostura|051810;05040|Anorí|052850;05042|Santa Fé De Antioquia|057050;05044|Anzá|056850;05045|Apartadó|057840;05051|Arboletes|057820;05055|Argelia|054830;05059|Armenia|055860;05079|Barbosa|051020;05086|Belmira|051420;05088|Bello|051050;05091|Betania|056070;05093|Betulia|056860;05101|Ciudad Bolívar|056460;05107|Briceño|052060;05113|Buriticá|057030;05120|Cáceres|052450;05125|Caicedo|056840;05129|Caldas|055440;05134|Campamento|052020;05138|Cañasgordas|057060;05142|Caracolí|053450;05145|Caramanta|056040;05147|Carepa|057850;05148|El Carmen De Viboral|054030;05150|Carolina|051840;05154|Caucasia|052410;05172|Chigorodó|057410;05190|Cisneros|053050;05197|Cocorná|054440;05206|Concepción|053810;05209|Concordia|056410;05212|Copacabana|051040;05234|Dabeiba|057430;05237|Donmatías|051850;05240|Ebéjico|055810;05250|El Bagre' +
  '|052430;05264|Entrerríos|051430;05266|Envigado|055420;05282|Fredonia|055070;05284|Frontino|057450;05306|Giraldo|057040;05308|Girardota|051030;05310|Gómez Plata|051830;05313|Granada|054410;05315|Guadalupe|051820;05318|Guarne|054050;05321|Guatapé|053840;05347|Heliconia|055820;05353|Hispania|056450;05360|Itagüí|055410;05361|Ituango|052070;05364|Jardín|056050;05368|Jericó|056010;05376|La Ceja|055010;05380|La Estrella|055460;05390|La Pintada|055060;05400|La Unión|055020;05411|Liborina|051460;05425|Maceo|053460;05440|Marinilla|054020;05467|Montebello|055040;05475|Murindó|056810;05480|Mutatá|057420;05483|Nariño|054840;05490|Necoclí|057870;05495|Nechí|052420;05501|Olaya|051450;05541|Peñol|053850;05543|Peque|057010;05576|Pueblorrico|056440;05579|Puerto Berrío|053420;05585|Puerto Nare|053430;05591|Puerto Triunfo|053440;05604|Remedios|052820;05607|Retiro|055430;05615|Rionegro|054040;05628|Sabanalarga|057020;05631|Sabaneta|055450;05642|Salgar|056470;05647|San Andrés De Cuerquía|052040;05649|San Ca' +
  'rlos|054420;05652|San Francisco|054810;05656|San Jerónimo|051070;05658|San José De La Montaña|051410;05659|San Juan De Urabá|057810;05660|San Luis|054430;05664|San Pedro De Los Milagros|051010;05665|San Pedro De Urabá|057830;05667|San Rafael|053830;05670|San Roque|053030;05674|San Vicente Ferrer|054010;05679|Santa Bárbara|055050;05686|Santa Rosa De Osos|051860;05690|Santo Domingo|053040;05697|El Santuario|054450;05736|Segovia|052810;05756|Sonsón|054820;05761|Sopetrán|051440;05789|Támesis|056020;05790|Tarazá|052460;05792|Tarso|056430;05809|Titiribí|055850;05819|Toledo|052050;05837|Turbo|057860;05842|Uramita|057440;05847|Urrao|056830;05854|Valdivia|052010;05856|Valparaíso|056030;05858|Vegachí|052830;05861|Venecia|056420;05873|Vigía Del Fuerte|056820;05885|Yalí|053010;05887|Yarumal|052030;05890|Yolombó|053020;05893|Yondó|053410;05895|Zaragoza|052440;08001|Barranquilla|080001;08078|Baranoa|082020;08137|Campo De La Cruz|084040;08141|Candelaria|084020;08296|Galapa|082001;08372|Juan De Acosta' +
  '|081040;08421|Luruaco|085060;08433|Malambo|083020;08436|Manatí|085020;08520|Palmar De Varela|083080;08549|Piojó|081060;08558|Polonuevo|082040;08560|Ponedera|084001;08573|Puerto Colombia|081001;08606|Repelón|085040;08634|Sabanagrande|083040;08638|Sabanalarga|085001;08675|Santa Lucía|084080;08685|Santo Tomás|083060;08758|Soledad|083001;08770|Suan|084060;08832|Tubará|081020;08849|Usiacurí|082060;11001|Bogotá, D.c.|110111;13001|Cartagena De Indias|130001;13006|Achí|134020;13030|Altos Del Rosario|133501;13042|Arenal|134520;13052|Arjona|131020;13062|Arroyohondo|131560;13074|Barranco De Loba|133510;13140|Calamar|131540;13160|Cantagallo|135060;13188|Cicuco|132550;13212|Córdoba|132501;13222|Clemencia|130510;13244|El Carmen De Bolívar|132050;13248|El Guamo|132001;13268|El Peñón|133550;13300|Hatillo De Loba|133040;13430|Magangué|132511;13433|Mahates|131040;13440|Margarita|133020;13442|María La Baja|131060;13458|Montecristo|134070;13468|Mompós|132560;13473|Morales|134540;13490|Norosí|134510;13549|' +
  'Pinillos|134001;13580|Regidor|133560;13600|Río Viejo|134501;13620|San Cristóbal|131520;13647|San Estanislao|130540;13650|San Fernando|133001;13654|San Jacinto|132030;13655|San Jacinto Del Cauca|134060;13657|San Juan Nepomuceno|132010;13667|San Martín De Loba|133530;13670|San Pablo|135040;13673|Santa Catalina|130501;13683|Santa Rosa|130520;13688|Santa Rosa Del Sur|135001;13744|Simití|135020;13760|Soplaviento|131501;13780|Talaigua Nuevo|132540;13810|Tiquisio|134040;13836|Turbaco|131001;13838|Turbaná|131010;13873|Villanueva|130530;13894|Zambrano|132040;15001|Tunja|150001;15022|Almeida|153020;15047|Aquitania|152420;15051|Arcabuco|154201;15087|Belén|150640;15090|Berbeo|152610;15092|Betéitiva|150610;15097|Boavita|151060;15104|Boyacá|153610;15106|Briceño|154670;15109|Buenavista|154840;15114|Busbanzá|152080;15131|Caldas|154660;15135|Campohermoso|152640;15162|Cerinza|150620;15172|Chinavita|153280;15176|Chiquinquirá|154640;15180|Chiscas|151401;15183|Chita|151601;15185|Chitaraque|154420;15187|Chi' +
  'vatá|150240;15189|Ciénega|153440;15204|Cómbita|150201;15212|Coper|154860;15215|Corrales|152060;15218|Covarachía|151040;15223|Cubará|151420;15224|Cucaita|154060;15226|Cuítiva|152230;15232|Chíquiza|154020;15236|Chivor|153001;15238|Duitama|150461;15244|El Cocuy|151280;15248|El Espino|151240;15272|Firavitoba|152250;15276|Floresta|150601;15293|Gachantivá|154220;15296|Gámeza|152020;15299|Garagoa|152860;15317|Guacamayas|151220;15322|Guateque|153050;15325|Guayatá|153040;15332|Güicán De La Sierra|151440;15362|Iza|152240;15367|Jenesano|153601;15368|Jericó|150840;15377|Labranzagrande|151840;15380|La Capilla|153220;15401|La Victoria|155001;15403|La Uvita|150860;15407|Villa De Leyva|154001;15425|Macanal|152840;15442|Maripí|154820;15455|Miraflores|152660;15464|Mongua|152001;15466|Monguí|152201;15469|Moniquirá|154260;15476|Motavita|154080;15480|Muzo|154880;15491|Nobsa|152280;15494|Nuevo Colón|153620;15500|Oicatá|150220;15507|Otanche|155060;15511|Pachavita|153210;15514|Páez|152620;15516|Paipa|150440;1' +
  '5518|Pajarito|152401;15522|Panqueba|151260;15531|Pauna|154801;15533|Paya|151820;15537|Paz De Río|150680;15542|Pesca|152460;15550|Pisba|151801;15572|Puerto Boyacá|155201;15580|Quípama|155020;15599|Ramiriquí|153401;15600|Ráquira|153801;15621|Rondón|153420;15632|Saboyá|154601;15638|Sáchica|153880;15646|Samacá|153660;15660|San Eduardo|152601;15664|San José De Pare|154460;15667|San Luis De Gaceno|152801;15673|San Mateo|151201;15676|San Miguel De Sema|153820;15681|San Pablo De Borbur|155040;15686|Santana|154440;15690|Santa María|152820;15693|Santa Rosa De Viterbo|150480;15696|Santa Sofía|154240;15720|Sativanorte|150820;15723|Sativasur|150801;15740|Siachoque|153460;15753|Soatá|151001;15755|Socotá|151620;15757|Socha|151640;15759|Sogamoso|152210;15761|Somondoco|153030;15762|Sora|154040;15763|Sotaquirá|150420;15764|Soracá|153480;15774|Susacón|150880;15776|Sutamarchán|153860;15778|Sutatenza|153060;15790|Tasco|151660;15798|Tenza|153201;15804|Tibaná|153260;15806|Tibasosa|152260;15808|Tinjacá|153840' +
  ';15810|Tipacoque|151020;15814|Toca|150260;15816|Togüí|154401;15820|Tópaga|152040;15822|Tota|152440;15832|Tununguá|154680;15835|Turmequé|153630;15837|Tuta|150401;15839|Tutazá|150660;15842|Úmbita|153240;15861|Ventaquemada|153640;15879|Viracachá|153450;15897|Zetaquira|152680;17001|Manizales|170001;17013|Aguadas|172020;17042|Anserma|177080;17050|Aranzazu|171040;17088|Belalcázar|177001;17174|Chinchiná|176020;17272|Filadelfia|171020;17380|La Dorada|175030;17388|La Merced|172060;17433|Manzanares|173020;17442|Marmato|178001;17444|Marquetalia|173040;17446|Marulanda|173001;17486|Neira|171001;17495|Norcasia|175001;17513|Pácora|172040;17524|Palestina|176040;17541|Pensilvania|173060;17614|Riosucio|178040;17616|Risaralda|177060;17653|Salamina|172001;17662|Samaná|174001;17665|San José|177040;17777|Supía|178020;17867|Victoria|174030;17873|Villamaría|176001;17877|Viterbo|177020;18001|Florencia|180001;18029|Albania|186030;18094|Belén De Los Andaquíes|186010;18150|Cartagena Del Chairá|183010;18205|Curill' +
  'o|186050;18247|El Doncello|181010;18256|El Paujíl|181030;18410|La Montañita|181050;18460|Milán|185030;18479|Morelia|185010;18592|Puerto Rico|182050;18610|San José Del Fragua|186070;18753|San Vicente Del Caguán|182010;18756|Solano|184010;18785|Solita|185070;18860|Valparaíso|185050;19001|Popayán|190001;19022|Almaguer|194080;19050|Argelia|195560;19075|Balboa|195530;19100|Bolívar|195001;19110|Buenos Aires|191001;19130|Cajibío|190501;19137|Caldono|192040;19142|Caloto|191070;19212|Corinto|191560;19256|El Tambo|193570;19290|Florencia|195040;19300|Guachené|191087;19318|Guapí|196001;19355|Inzá|192531;19364|Jambaló|192020;19392|La Sierra|194001;19397|La Vega|194020;19418|López De Micay|196060;19450|Mercaderes|195060;19455|Miranda|191520;19473|Morales|190550;19513|Padilla|191540;19517|Páez|192501;19532|Patía|195501;19533|Piamonte|194550;19548|Piendamó - Tunía|190530;19573|Puerto Tejada|191501;19585|Puracé|193001;19622|Rosas|193550;19693|San Sebastián|194501;19698|Santander De Quilichao|191030;197' +
  '01|Santa Rosa|194520;19743|Silvia|192070;19760|Sotara|193501;19780|Suárez|190580;19785|Sucre|194060;19807|Timbío|193520;19809|Timbiquí|196030;19821|Toribío|192001;19824|Totoró|192570;19845|Villa Rica|191060;20001|Valledupar|200001;20011|Aguachica|205010;20013|Agustín Codazzi|202050;20032|Astrea|201040;20045|Becerril|203001;20060|Bosconia|201020;20175|Chimichagua|201050;20178|Chiriguaná|203040;20228|Curumaní|203060;20238|El Copey|201010;20250|El Paso|201030;20295|Gamarra|205001;20310|González|205030;20383|La Gloria|204060;20400|La Jagua De Ibirico|203020;20443|Manaure Balcón Del Cesar|202001;20517|Pailitas|204001;20550|Pelaya|204040;20570|Pueblo Bello|201001;20614|Río De Oro|205040;20621|La Paz|202010;20710|San Alberto|205070;20750|San Diego|202030;20770|San Martín|205050;20787|Tamalameque|204020;23001|Montería|230001;23068|Ayapel|233530;23079|Buenavista|233020;23090|Canalete|235040;23162|Cereté|230550;23168|Chimá|232010;23182|Chinú|232050;23189|Ciénaga De Oro|232520;23300|Cotorra|23050' +
  '1;23350|La Apartada|233501;23417|Lorica|231020;23419|Los Córdobas|235020;23464|Momil|232001;23466|Montelíbano|234001;23500|Moñitos|231001;23555|Planeta Rica|233040;23570|Pueblo Nuevo|233001;23574|Puerto Escondido|235001;23580|Puerto Libertador|234030;23586|Purísima De La Concepción|231540;23660|Sahagún|232540;23670|San Andrés De Sotavento|232030;23672|San Antero|231520;23675|San Bernardo Del Viento|231501;23678|San Carlos|232501;23682|San José De Uré|234010;23686|San Pelayo|230520;23807|Tierralta|234501;23815|Tuchín|232020;23855|Valencia|234530;25001|Agua De Dios|252850;25019|Albán|253201;25035|Anapoima|252640;25040|Anolaima|253040;25053|Arbeláez|252001;25086|Beltrán|253260;25095|Bituima|253220;25099|Bojacá|253001;25120|Cabrera|252040;25123|Cachipay|253020;25126|Cajicá|250240;25148|Caparrapí|253460;25151|Cáqueza|251820;25154|Carmen De Carupa|250420;25168|Chaguaní|253240;25175|Chía|250001;25178|Chipaque|251801;25181|Choachí|251620;25183|Chocontá|250801;25200|Cogua|250401;25214|Cota|2500' +
  '10;25224|Cucunubá|250450;25245|El Colegio|252630;25258|El Peñón|254020;25260|El Rosal|250210;25269|Facatativá|253051;25279|Fómeque|251640;25281|Fosca|251830;25286|Funza|250020;25288|Fúquene|250620;25290|Fusagasugá|252211;25293|Gachalá|251250;25295|Gachancipá|251020;25297|Gachetá|251230;25299|Gama|251240;25307|Girardot|252431;25312|Granada|252250;25317|Guachetá|250610;25320|Guaduas|253440;25322|Guasca|251210;25324|Guataquí|252820;25326|Guatavita|251060;25328|Guayabal De Síquima|253210;25335|Guayabetal|251850;25339|Gutiérrez|251860;25368|Jerusalén|252810;25372|Junín|251220;25377|La Calera|251201;25386|La Mesa|252601;25394|La Palma|253801;25398|La Peña|253640;25402|La Vega|253610;25407|Lenguazaque|250601;25426|Machetá|250840;25430|Madrid|250030;25436|Manta|250830;25438|Medina|251420;25473|Mosquera|250040;25483|Nariño|252830;25486|Nemocón|251030;25488|Nilo|252401;25489|Nimaima|253630;25491|Nocaima|253620;25506|Venecia|252030;25513|Pacho|254001;25518|Paime|254040;25524|Pandi|252010;25530|Pa' +
  'ratebueno|251401;25535|Pasca|252201;25572|Puerto Salgar|253480;25580|Pulí|252801;25592|Quebradanegra|253420;25594|Quetame|251840;25596|Quipile|253030;25599|Apulo|252650;25612|Ricaurte|252410;25645|San Antonio Del Tequendama|252620;25649|San Bernardo|252020;25653|San Cayetano|254050;25658|San Francisco|253601;25662|San Juan De Rioseco|253250;25718|Sasaima|253401;25736|Sesquilé|251050;25740|Sibaté|250070;25743|Silvania|252240;25745|Simijaca|250640;25754|Soacha|250051;25758|Sopó|251001;25769|Subachoque|250220;25772|Suesca|251040;25777|Supatá|253660;25779|Susa|250630;25781|Sutatausa|250440;25785|Tabio|250230;25793|Tausa|250410;25797|Tena|252610;25799|Tenjo|250201;25805|Tibacuy|252230;25807|Tibirita|250820;25815|Tocaima|252840;25817|Tocancipá|251010;25823|Topaipí|253820;25839|Ubalá|251260;25841|Ubaque|251601;25843|Villa De San Diego De Ubaté|250430;25845|Une|251810;25851|Útica|253430;25862|Vergara|253650;25867|Vianí|253230;25871|Villagómez|254030;25873|Villapinzón|250810;25875|Villeta|25341' +
  '0;25878|Viotá|252660;25885|Yacopí|253840;25898|Zipacón|253010;25899|Zipaquirá|250251;27001|Quibdó|270001;27006|Acandí|278010;27025|Alto Baudó|276070;27050|Atrato|272010;27073|Bagadó|271050;27075|Bahía Solano|276030;27077|Bajo Baudó|275030;27099|Bojayá|277050;27135|El Cantón Del San Pablo|272040;27150|Carmen Del Darién|277030;27160|Cértegui|272020;27205|Condoto|273030;27245|El Carmen De Atrato|271010;27250|El Litoral Del San Juan|275050;27361|Istmina|274010;27372|Juradó|276010;27413|Lloró|271030;27425|Medio Atrato|270070;27430|Medio Baudó|275010;27450|Medio San Juan|274030;27491|Nóvita|273050;27495|Nuquí|276050;27580|Río Iró|273010;27600|Río Quito|272050;27615|Riosucio|277010;27660|San José Del Palmar|273070;27745|Sipí|274050;27787|Tadó|271070;27800|Unguía|278030;27810|Unión Panamericana|272030;41001|Neiva|410001;41006|Acevedo|417070;41013|Agrado|414040;41016|Aipe|411001;41020|Algeciras|413040;41026|Altamira|416020;41078|Baraya|411060;41132|Campoalegre|413020;41206|Colombia|411080;41244' +
  '|Elías|417001;41298|Garzón|414020;41306|Gigante|414001;41319|Guadalupe|416040;41349|Hobo|413060;41357|Íquira|412060;41359|Isnos|418040;41378|La Argentina|415080;41396|La Plata|415060;41483|Nátaga|415020;41503|Oporapa|418001;41518|Paicol|415040;41524|Palermo|412001;41530|Palestina|417060;41548|Pital|414060;41551|Pitalito|417030;41615|Rivera|413001;41660|Saladoblanco|418020;41668|San Agustín|418060;41676|Santa María|412020;41770|Suaza|416080;41791|Tarqui|416001;41797|Tesalia|415001;41799|Tello|411040;41801|Teruel|412040;41807|Timaná|417010;41872|Villavieja|411020;41885|Yaguará|412080;44001|Riohacha|440001;44035|Albania|443001;44078|Barrancas|443040;44090|Dibulla|446001;44098|Distracción|444001;44110|El Molino|444050;44279|Fonseca|444010;44378|Hatonuevo|443020;44420|La Jagua Del Pilar|445040;44430|Maicao|442001;44560|Manaure|441001;44650|San Juan Del Cesar|444030;44847|Uribia|441020;44855|Urumita|445020;44874|Villanueva|445001;47001|Santa Marta|470001;47030|Algarrobo|472040;47053|Aracatac' +
  'a|472001;47058|Ariguaní|475010;47161|Cerro De San Antonio|476020;47170|Chivolo|476060;47189|Ciénaga|478001;47205|Concordia|476030;47245|El Banco|473040;47258|El Piñón|476001;47268|El Retén|478060;47288|Fundación|472020;47318|Guamal|473020;47460|Nueva Granada|475020;47541|Pedraza|476040;47545|Pijiño Del Carmen|474040;47551|Pivijay|477050;47555|Plato|475030;47570|Puebloviejo|478040;47605|Remolino|477020;47660|Sabanas De San Ángel|475001;47675|Salamina|477040;47692|San Sebastián De Buenavista|473001;47703|San Zenón|474060;47707|Santa Ana|474020;47720|Santa Bárbara De Pinto|474001;47745|Sitionuevo|477001;47798|Tenerife|475050;47960|Zapayán|476050;47980|Zona Bananera|478020;50001|Villavicencio|500001;50006|Acacías|507001;50110|Barranca De Upía|501001;50124|Cabuyaro|501011;50150|Castilla La Nueva|507041;50223|Cubarral|506001;50226|Cumaral|501021;50245|El Calvario|501041;50251|El Castillo|506041;50270|El Dorado|506021;50287|Fuente De Oro|504021;50313|Granada|504001;50318|Guamal|507051;50325|M' +
  'apiripán|503021;50330|Mesetas|505001;50350|La Macarena|505021;50370|Uribe|505041;50400|Lejanías|506061;50450|Puerto Concordia|503041;50568|Puerto Gaitán|502041;50573|Puerto López|502001;50577|Puerto Lleras|503001;50590|Puerto Rico|503061;50606|Restrepo|501031;50680|San Carlos De Guaroa|507011;50683|San Juan De Arama|504041;50686|San Juanito|501051;50689|San Martín|507021;50711|Vistahermosa|504061;52001|Pasto|520001;52019|Albán|521050;52022|Aldana|524540;52036|Ancuyá|526001;52051|Arboleda|520570;52079|Barbacoas|528060;52083|Belén|521080;52110|Buesaco|520501;52203|Colón|521060;52207|Consacá|522540;52210|Contadero|523080;52215|Córdoba|524001;52224|Cuaspúd|524560;52227|Cumbal|525001;52233|Cumbitara|526560;52240|Chachagüí|522001;52250|El Charco|527520;52254|El Peñol|522080;52256|El Rosario|527030;52258|El Tablón De Gómez|520530;52260|El Tambo|522060;52287|Funes|523520;52317|Guachucal|524580;52320|Guaitarilla|525501;52323|Gualmatán|524501;52352|Iles|523060;52354|Imués|523020;52356|Ipiales|52' +
  '4060;52378|La Cruz|521020;52381|La Florida|522040;52385|La Llanada|526501;52390|La Tola|527540;52399|La Unión|521520;52405|Leiva|527060;52411|Linares|522501;52418|Los Andes|526520;52427|Magüí|528001;52435|Mallama|525060;52473|Mosquera|527580;52480|Nariño|522020;52490|Olaya Herrera|527560;52506|Ospina|523040;52520|Francisco Pizarro|528560;52540|Policarpa|527001;52560|Potosí|524030;52565|Providencia|526020;52573|Puerres|523540;52585|Pupiales|524520;52612|Ricaurte|525030;52621|Roberto Payán|528030;52678|Samaniego|526040;52683|Sandoná|522520;52685|San Bernardo|521001;52687|San Lorenzo|521540;52693|San Pablo|521040;52694|San Pedro De Cartago|521501;52696|Santa Bárbara|527501;52699|Santacruz|525570;52720|Sapuyes|525550;52786|Taminango|521560;52788|Tangua|523501;52835|San Andrés De Tumaco|528501;52838|Túquerres|525520;52885|Yacuanquer|523001;54001|San José De Cúcuta|540001;54003|Ábrego|546070;54051|Arboledas|544550;54099|Bochalema|543010;54109|Bucarasica|545550;54125|Cácota|544010;54128|Cáchi' +
  'ra|546030;54172|Chinácota|541070;54174|Chitagá|544030;54206|Convención|547050;54223|Cucutilla|544520;54239|Durania|544510;54245|El Carmen|547070;54250|El Tarra|548050;54261|El Zulia|545510;54313|Gramalote|545050;54344|Hacarí|546510;54347|Herrán|542010;54377|Labateca|542050;54385|La Esperanza|546050;54398|La Playa|546530;54405|Los Patios|541010;54418|Lourdes|545070;54480|Mutiscua|544070;54498|Ocaña|546551;54518|Pamplona|543050;54520|Pamplonita|543030;54553|Puerto Santander|548030;54599|Ragonvalia|541050;54660|Salazar|544570;54670|San Calixto|547010;54673|San Cayetano|545010;54680|Santiago|545030;54720|Sardinata|545530;54743|Silos|544050;54800|Teorama|547030;54810|Tibú|548010;54820|Toledo|542030;54871|Villa Caro|546010;54874|Villa Del Rosario|541030;63001|Armenia|630001;63111|Buenavista|632040;63130|Calarcá|632001;63190|Circasia|631001;63212|Córdoba|632020;63272|Filandia|634001;63302|Génova|632080;63401|La Tebaida|633020;63470|Montenegro|633001;63548|Pijao|632060;63594|Quimbaya|634020;63' +
  '690|Salento|631020;66001|Pereira|660001;66045|Apía|663030;66075|Balboa|662010;66088|Belén De Umbría|664040;66170|Dosquebradas|661001;66318|Guática|664010;66383|La Celia|662030;66400|La Virginia|662001;66440|Marsella|661040;66456|Mistrató|664020;66572|Pueblo Rico|663011;66594|Quinchía|664001;66682|Santa Rosa De Cabal|661020;66687|Santuario|663001;68001|Bucaramanga|680001;68013|Aguada|685521;68020|Albania|684531;68051|Aratoca|682051;68077|Barbosa|684511;68079|Barichara|684041;68081|Barrancabermeja|687031;68092|Betulia|686501;68101|Bolívar|685001;68121|Cabrera|683501;68132|California|680511;68147|Capitanejo|681541;68152|Carcasí|681521;68160|Cepitá|682061;68162|Cerrito|681501;68167|Charalá|682551;68169|Charta|680551;68176|Chima|683001;68179|Chipatá|685551;68190|Cimitarra|686041;68207|Concepción|681511;68209|Confines|683531;68211|Contratación|683071;68217|Coromoro|682531;68229|Curití|682041;68235|El Carmen De Chucurí|686561;68245|El Guacamayo|683061;68250|El Peñón|685021;68255|El Playón|687' +
  '501;68264|Encino|682541;68266|Enciso|681561;68271|Florián|684541;68276|Floridablanca|681001;68296|Galán|684051;68298|Gámbita|683031;68307|Girón|687541;68318|Guaca|681031;68320|Guadalupe|683051;68322|Guapotá|683011;68324|Guavatá|684501;68327|Güepsa|685541;68344|Hato|683571;68368|Jesús María|684551;68370|Jordán|684011;68377|La Belleza|685061;68385|Landázuri|686021;68397|La Paz|685511;68406|Lebrija|687571;68418|Los Santos|684001;68425|Macaravita|681531;68432|Málaga|682011;68444|Matanza|680561;68464|Mogotes|682501;68468|Molagavita|682031;68498|Ocamonte|682561;68500|Oiba|683021;68502|Onzaga|682521;68522|Palmar|683581;68524|Palmas Del Socorro|683541;68533|Páramo|683521;68547|Piedecuesta|681011;68549|Pinchote|683511;68572|Puente Nacional|684521;68573|Puerto Parra|686001;68575|Puerto Wilches|687061;68615|Rionegro|687511;68655|Sabana De Torres|687001;68669|San Andrés|682001;68673|San Benito|685531;68679|San Gil|684031;68682|San Joaquín|682511;68684|San José De Miranda|682021;68686|San Miguel|68' +
  '1551;68689|San Vicente De Chucurí|686531;68705|Santa Bárbara|681021;68720|Santa Helena Del Opón|685501;68745|Simacota|683561;68755|Socorro|683551;68770|Suaita|683041;68773|Sucre|685041;68780|Suratá|680501;68820|Tona|680541;68855|Valle De San José|682571;68861|Vélez|685561;68867|Vetas|680531;68872|Villanueva|684021;68895|Zapatoca|684061;70001|Sincelejo|700001;70110|Buenavista|702030;70124|Caimito|704010;70204|Colosó|707030;70215|Corozal|705030;70221|Coveñas|706050;70230|Chalán|701010;70233|El Roble|705050;70235|Galeras|702050;70265|Guaranda|703070;70400|La Unión|704050;70418|Los Palmitos|701050;70429|Majagual|703050;70473|Morroa|701070;70508|Ovejas|701030;70523|Palmito|706030;70670|Sampués|705070;70678|San Benito Abad|703010;70702|San Juan De Betulia|705010;70708|San Marcos|704030;70713|San Onofre|707010;70717|San Pedro|702010;70742|San Luis De Sincé|702070;70771|Sucre|703030;70820|Santiago De Tolú|706010;70823|Tolú Viejo|707050;73001|Ibagué|730001;73024|Alpujarra|734560;73026|Alvarado|' +
  '730520;73030|Ambalema|731001;73043|Anzoátegui|730540;73055|Armero|732060;73067|Ataco|735050;73124|Cajamarca|732501;73148|Carmen De Apicalá|733590;73152|Casabianca|731520;73168|Chaparral|735560;73200|Coello|733501;73217|Coyaima|735020;73226|Cunday|734040;73236|Dolores|734540;73268|Espinal|733520;73270|Falan|732001;73275|Flandes|733510;73283|Fresno|731560;73319|Guamo|733540;73347|Herveo|731540;73349|Honda|732040;73352|Icononzo|734020;73408|Lérida|731020;73411|Líbano|731040;73443|San Sebastián De Mariquita|732020;73449|Melgar|734001;73461|Murillo|731060;73483|Natagaima|735001;73504|Ortega|735501;73520|Palocabildo|731580;73547|Piedras|730501;73555|Planadas|735070;73563|Prado|734520;73585|Purificación|734501;73616|Rioblanco|735580;73622|Roncesvalles|735550;73624|Rovira|733040;73671|Saldaña|733570;73675|San Antonio|735530;73678|San Luis|733001;73686|Santa Isabel|730560;73770|Suárez|733580;73854|Valle De San Juan|733020;73861|Venadillo|730580;73870|Villahermosa|731501;73873|Villarrica|734060;' +
  '76001|Cali|760001;76020|Alcalá|762040;76036|Andalucía|763010;76041|Ansermanuevo|762010;76054|Argelia|761510;76100|Bolívar|761001;76109|Buenaventura|764501;76111|Guadalajara De Buga|763041;76113|Bugalagrande|763001;76122|Caicedonia|762540;76126|Calima|760530;76130|Candelaria|763570;76147|Cartago|762021;76233|Dagua|760520;76243|El Águila|762001;76246|El Cairo|761501;76248|El Cerrito|763520;76250|El Dovio|761560;76275|Florida|763560;76306|Ginebra|763510;76318|Guacarí|763501;76364|Jamundí|764001;76377|La Cumbre|760510;76400|La Unión|761540;76403|La Victoria|762510;76497|Obando|762501;76520|Palmira|763531;76563|Pradera|763550;76606|Restrepo|760540;76616|Riofrío|761030;76622|Roldanillo|761550;76670|San Pedro|763030;76736|Sevilla|762530;76823|Toro|761520;76828|Trujillo|761020;76834|Tuluá|763021;76845|Ulloa|762030;76863|Versalles|761530;76869|Vijes|760550;76890|Yotoco|761040;76892|Yumbo|760501;76895|Zarzal|762520;81001|Arauca|810001;81065|Arauquita|816010;81220|Cravo Norte|812010;81300|Fortul|' +
  '814050;81591|Puerto Rondón|813010;81736|Saravena|815010;81794|Tame|814010;85001|Yopal|850001;85010|Aguazul|856010;85015|Chámeza|856030;85125|Hato Corozal|852010;85136|La Salina|851010;85139|Maní|854010;85162|Monterrey|855010;85225|Nunchía|851070;85230|Orocué|853050;85250|Paz De Ariporo|852030;85263|Pore|852050;85279|Recetor|856050;85300|Sabanalarga|855050;85315|Sácama|851030;85325|San Luis De Palenque|853030;85400|Támara|851050;85410|Tauramena|854030;85430|Trinidad|853010;85440|Villanueva|855030;86001|Mocoa|860001;86219|Colón|861040;86320|Orito|862001;86568|Puerto Asís|862060;86569|Puerto Caicedo|862080;86571|Puerto Guzmán|863001;86573|Puerto Leguízamo|864001;86749|Sibundoy|861020;86755|San Francisco|861001;86757|San Miguel|862040;86760|Santiago|861060;86865|Valle Del Guamuez|862020;86885|Villagarzón|861080;88001|San Andrés|880001;88564|Providencia|880020;91001|Leticia|910001;91263|El Encanto|913010;91405|La Chorrera|914050;91407|La Pedrera|917010;91430|La Victoria|916017;91460|Mirití ' +
  '- Paraná|916057;91530|Puerto Alegría|913050;91536|Puerto Arica|912010;91540|Puerto Nariño|911010;91669|Puerto Santander|915010;91798|Tarapacá|911030;94001|Inírida|940001;94343|Barranco Minas|944010;94663|Mapiripana|944057;94883|San Felipe|942010;94884|Puerto Colombia|941037;94885|La Guadalupe|942057;94886|Cacahual|941010;94887|Pana Pana|943017;94888|Morichal|943057;95001|San José Del Guaviare|950001;95015|Calamar|953001;95025|El Retorno|951001;95200|Miraflores|952001;97001|Mitú|970001;97161|Carurú|973001;97511|Pacoa|972007;97666|Taraira|972040;97777|Papunahua|973047;97889|Yavaraté|971007;99001|Puerto Carreño|990001;99524|La Primavera|992001;99624|Santa Rosalía|992050;99773|Cumaribo|991001';

let municipality_index: Map<string, DianMunicipality> | null = null;
let municipality_name_index: Map<string, DianMunicipality> | null = null;

/**
 * Normaliza un nombre de municipio para poder compararlo: sin tildes, sin
 * puntuación, sin dobles espacios y en minúsculas. `Bogotá, D.c.`, `BOGOTA DC` y
 * `bogota d c` colapsan al mismo `bogota d c`.
 */
function normalizeName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Construye los índices una sola vez, al primer acceso. */
function buildIndexes(): void {
  if (municipality_index) return;
  const by_code = new Map<string, DianMunicipality>();
  const by_name = new Map<string, DianMunicipality>();
  for (const row of MUNICIPALITIES_RAW.split(';')) {
    const [code, name, postal_code] = row.split('|');
    const department_code = code.slice(0, 2);
    const municipality: DianMunicipality = {
      code,
      name,
      department_code,
      department_name:
        DIAN_DEPARTMENTS[department_code as DianDepartmentCode] ?? '',
      postal_code,
    };
    by_code.set(code, municipality);
    // Clave `dd:nombre` — hay nombres repetidos entre departamentos, así que la
    // clave incluye el departamento. La primera aparición gana; el orden es por
    // código DANE, luego es determinista.
    const key = `${department_code}:${normalizeName(name)}`;
    if (!by_name.has(key)) by_name.set(key, municipality);
  }
  municipality_index = by_code;
  municipality_name_index = by_name;
}

/** Total de municipios del catálogo. Útil para aserciones en tests. */
export const DIAN_MUNICIPALITY_COUNT = 1122;

/** Municipio por código DANE de 5 dígitos, o `null` si no está en la lista. */
export function findDianMunicipality(
  code: string | null | undefined,
): DianMunicipality | null {
  if (!code) return null;
  buildIndexes();
  return municipality_index!.get(code.trim()) ?? null;
}

/**
 * Municipio por nombre DENTRO de un departamento. Exige el departamento porque
 * hay nombres repetidos entre departamentos (p. ej. varios «San Juan»): buscar
 * solo por nombre elegiría un municipio arbitrario, que es exactamente el
 * defecto que este archivo existe para evitar.
 */
export function findDianMunicipalityByName(
  name: string | null | undefined,
  department_code: string | null | undefined,
): DianMunicipality | null {
  if (!name || !department_code) return null;
  buildIndexes();
  const key = `${department_code.trim()}:${normalizeName(name)}`;
  return municipality_name_index!.get(key) ?? null;
}

/** `true` si el código está en la lista de municipios que la DIAN acepta. */
export function isDianMunicipalityCode(value: unknown): boolean {
  return typeof value === 'string' && findDianMunicipality(value) !== null;
}

/** Todos los municipios, ordenados por código DANE. */
export function listDianMunicipalities(): readonly DianMunicipality[] {
  buildIndexes();
  return [...municipality_index!.values()];
}

/**
 * Resuelve una dirección a su municipio del catálogo DIAN, probando en orden:
 *   1. el código DANE, si viene y es válido;
 *   2. nombre + departamento, si el código falta o no está en la lista.
 *
 * Devuelve `null` cuando no logra resolverlo. **Ese `null` es la respuesta
 * útil**: significa «no sé en qué municipio está este cliente». El llamador debe
 * decidir explícitamente qué hacer (rechazar la emisión, pedir el dato, o
 * documentar el sustituto), NUNCA rellenar Bogotá en silencio.
 */
export function resolveDianMunicipality(address: {
  city_code?: string | null;
  city_name?: string | null;
  department_code?: string | null;
}): DianMunicipality | null {
  return (
    findDianMunicipality(address.city_code) ??
    findDianMunicipalityByName(address.city_name, address.department_code)
  );
}

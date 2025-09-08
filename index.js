const express = require("express");
const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

// === Helpers ===
const toStr = v => (v ?? "").toString();
const splitIds = s => toStr(s).split(",").map(x => x.trim()).filter(Boolean);
const normalize = s =>
  toStr(s).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
const firstMatchFromList = (arr, mapObj) => arr.find(id => mapObj[id]) || null;
const firstIdInFreeText = (text, mapObj) => {
  const ids = toStr(text).match(/\d+/g) || [];
  return firstMatchFromList(ids, mapObj);
};

// === Diccionarios ===
const CAMPANAS = {
  "1289547": "Campañas",
  "1289543": "Gestión del asesor",
  "1288371": "Referidos",
  "1287123": "Club Importadores FC",
  "1287125": "Club de Importadores AI",
  "1287127": "Web Cámara",
  "1287129": "Club de Importadores EC",
  "1287131": "Web Alibox",
  "1287157": "Eventos",
  "1287159": "Revistas GH",
  "1287135": "TIKTOK",
  "1287133": "Club de Importadores GYE",
  "1290102": "Maquinas",
  "1290588": "Chakana News",
  "1290347": "Generadores",
  "1289545": "EXISTENTE",
  "1287139": "Club de Importadores Cuenca",
  "1288727": "Alibox Plataforma",
  "1289051": "Papelería",
  "1289135": "RADIO",
  "1287399": "Cantón",
  "1287311": "Madre",
  "1287313": "YouTube",
  "1290009": "Webinar Maquinaria",
  "1288569": "Mailing",
  "1288373": "Otros",
  "1290011": "Webinar Carga Compartida",
  "1290033": "Sem.Esmaraldas.29.05.2025",
  "1290069": "Sem.Jipijapa.04.06.2025",
  "1290047": "TLC12/06/2025",
  "1290169": "WEB.PROECUADOR",
  "1290211": "WEB.NAVIDAD",
  "1290427": "WEB.CONAGOPARE",
  "1290589": "Tsachila Forum 2025",
  "1290068": "sem.otavalo.8.07.2025",
  "1290662": "Sem.Condor.19.06.2026",
  "1290080": "sem.milagro.3.07.2025",
  "1290978": "sem.tlc.tungurahua.jul",
  "1290988": "sem.napo.24.07.2025",
  "1290992": "web.yiwu.20.07.2025",
  "1291077": "sem.loja.24.07.2025",
  "1291299": "WEB LC"
};

const COT_CHINA = {
  "1289523": "Proveedor Cliente",
  "1289525": "Cotizador",
  "1289527": "Vendedor",
  "1289529": "Recotizado"
};

const ETAPAS = {
  "58473951": "Contacto inicial",
  "58473955": "DEFINICION DE LISTA",
  "74938892": "agendado",
  "58474207": "COTIZA EL ASESOR",
  "58473959": "COTIZA EL CLIENTE",
  "85672980": "COT LCL",
  "61089931": "FALTA INFO PARA LIQUIDAR",
  "58474131": "POR LIQUIDAR",
  "58964555": "LIQUIDADO",
  "58474135": "LIQUIDACION ENVIADA",
  "58474143": "CONTRATO",
  "73578024": "VENTA CONCRETADA",
  "59561095": "SERVICIOS CAMARA"
};

const TIPOS_BY_ID = {
  "1284399": "Negocio Existente",
  "1276028": "Negocio Nuevo 1",
  "1284403": "Negocio Nuevo 2",
  "1287460": "Asignado",
  "1287462": "Recuperado"
};
const TIPOS_BY_NAME = Object.fromEntries(
  Object.entries(TIPOS_BY_ID).map(([id, nombre]) => [normalize(nombre), { id, nombre }])
);

const ASESORES = {
  "1277529": "Denisse de la Cruz",
  "1277511": "Sami Cachiguango",
  "1277519": "Daniel Benitez",
  "1277509": "Marly Moran",
  "1277517": "Margarita Carpio",
  "1285361": "Pablo Jara",
  "1287139": "Gabriela Nuñez",
  "1288519": "Martin Salazar",
  "1290407": "Ivis Anchundia",
  "1289623": "Jhonny López",
  "1285545": "Alibox",
  "1288951": "Guillermo Chapoñan Castillo",
  "1288517": "Diego Trujillo",
  "1279467": "Sebastián Bernal",
  "1277523": "Carlos Castro",
  "1277525": "Maria Cecilia Noboa",
  "1277527": "Nicolas Mejía",
  "1278911": "Karina Procel",
  "1277515": "Karina Vivas",
  "1277513": "Lizeth Villarroel",
  "1278909": "Nicolas Vacacela",
  "1287189": "Want",
  "1287293": "Kgallardo",
  "1290976": "Damaris Ñacato",
  "1291073": "Veyda Pinela"
};

// === POST /mapear ===
app.post("/mapear", (req, res) => {
  const input = req.body;

  const campaniaIds = splitIds(input.campania_enum_ids);
  const campaniaId = firstMatchFromList(campaniaIds, CAMPANAS);
  const campaniaNombre = campaniaId ? CAMPANAS[campaniaId] : "Desconocido";

  const cotChinaId = firstMatchFromList(splitIds(input.cot_china_enum), COT_CHINA) ||
                     firstIdInFreeText(input.cot_china_enum, COT_CHINA);
  const cotChinaNombre = cotChinaId ? COT_CHINA[cotChinaId] : "";

  const etapaId = toStr(input.etapa_id);
  const etapaLegible = ETAPAS[etapaId] || "Etapa desconocida";

  const tipoValores = splitIds(input.tipo_enum_ids);
  let tipoId = null, tipoNombre = "Desconocido";
  for (const v of tipoValores) {
    if (TIPOS_BY_ID[v]) { tipoId = v; tipoNombre = TIPOS_BY_ID[v]; break; }
    const n = normalize(v);
    if (TIPOS_BY_NAME[n]) {
      tipoId = TIPOS_BY_NAME[n].id;
      tipoNombre = TIPOS_BY_NAME[n].nombre;
      break;
    }
  }

  const inAsesorId = toStr(input.asesor_id);
  const inAsesorTexto = toStr(input.asesor_texto);
  let asesorId = null, asesorNombre = "No encontrado";
  if (ASESORES[inAsesorId]) {
    asesorId = inAsesorId;
    asesorNombre = ASESORES[inAsesorId];
  } else {
    const found = firstIdInFreeText(inAsesorTexto, ASESORES);
    if (found) {
      asesorId = found;
      asesorNombre = ASESORES[found];
    }
  }

  res.json({
    Campania_Ids: campaniaIds.join(","),
    Campania_Id: campaniaId,
    Campania_Nombre: campaniaNombre,
    CotChina_Id: cotChinaId,
    CotChina_Nombre: cotChinaNombre,
    Etapa_Id: etapaId,
    Etapa_Legible: etapaLegible,
    Tipo_Id: tipoId,
    Tipo_Nombre: tipoNombre,
    Tipos_Detectados: tipoValores.join("|"),
    Asesor_Id: asesorId,
    Asesor_Nombre: asesorNombre
  });
});

// === GET /lookup/:diccionario/:id ===
const DICCIONARIOS = {
  campanas: CAMPANAS,
  cot_china: COT_CHINA,
  etapas: ETAPAS,
  tipos: TIPOS_BY_ID,
  asesores: ASESORES
};

app.get("/lookup/:diccionario/:id", (req, res) => {
  const diccionario = DICCIONARIOS[req.params.diccionario];
  const id = req.params.id;
  if (!diccionario) {
    return res.status(400).json({ error: "Diccionario no válido" });
  }
  const valor = diccionario[id];
  if (!valor) {
    return res.status(404).json({ error: "ID no encontrado" });
  }
  res.json({ id, nombre: valor });
});

// === Root ===
app.get("/", (req, res) => {
  res.send("✅ DiccionarioCESCH API funcionando.");
});

app.listen(PORT, () => {
  console.log("✅ Servidor corriendo en puerto", PORT);
});

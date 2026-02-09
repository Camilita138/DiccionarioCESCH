// index.js
const express = require("express");
const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

/* ================= Helpers ================= */
const toStr = (v) => (v ?? "").toString();
const norm = (s) =>
  toStr(s).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

const splitIds = (s) => toStr(s).split(",").map((x) => x.trim()).filter(Boolean);
const firstMatchFromList = (arr, mapObj) => arr.find((id) => mapObj[id]) || null;
const firstIdInFreeText = (text, mapObj) => {
  const ids = toStr(text).match(/\d+/g) || [];
  return firstMatchFromList(ids, mapObj);
};

// Normaliza CFs de Kommo v4 → { id, values }
const normalizeCFs = (lead) => {
  if (Array.isArray(lead?.custom_fields)) return lead.custom_fields;
  if (Array.isArray(lead?.custom_fields_values)) {
    return lead.custom_fields_values.map((cf) => ({
      id: String(cf.field_id),
      values: cf.values,
    }));
  }
  return [];
};

// Devuelve el primer valor y enum info de un CF
const cfFirst = (cf) => {
  const v = cf?.values?.[0] || {};
  return { value: v.value ?? null, enum_id: v.enum_id ?? null };
};

// Acepta distintas formas del payload
function pickLeads(body) {
  const asArray = (v) => (Array.isArray(v) ? v : v && typeof v === "object" ? [v] : []);
  if (Array.isArray(body?.leads)) return body.leads;
  if (body?.leads?.status) return asArray(body.leads.status);
  if (Array.isArray(body?.status)) return body.status;
  if (body?.status) return asArray(body.status);
  if (Array.isArray(body?.payload?.leads)) return body.payload.leads;
  if (body?.payload?.leads?.status) return asArray(body.payload.leads.status);
  return [];
}
function pickAccount(body) {
  return body?.account || body?.payload?.account || null;
}

// Key “bonita”: "URL carpeta del Cliente" → "Url_Carpeta_Del_Cliente"
const keyify = (label) =>
  norm(label)
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("_");

// Limpia a solo dígitos
const cleanDigits = (s) => toStr(s).replace(/\D+/g, "");

// === Limpieza de celular Ecuador a formato 09******** ===
function cleanEcPhone(raw) {
  if (!raw) return "";
  const s = String(raw);

  let m = s.match(/(?:\+?593|593|0)?\s*9\d{8}/);
  if (!m) {
    for (const p of s.split(",").map((x) => x.trim())) {
      m = p.match(/(?:\+?593|593|0)?\s*9\d{8}/);
      if (m) break;
    }
  }
  if (!m) return "";

  let d = m[0].replace(/\D/g, "");
  if (d.startsWith("593")) d = d.slice(3);
  if (!d.startsWith("0")) d = "0" + d;
  return d.slice(0, 10);
}

/** ====== FECHAS con TZ ====== **/
// Sumar días (para fecha de cierre) y devolver formatos y partes
function addDaysTZ(days = 0, tz = "America/Guayaquil") {
  const now = new Date();
  const localNow = new Date(now.toLocaleString("en-US", { timeZone: tz }));
  localNow.setDate(localNow.getDate() + Number(days || 0));

  const y = localNow.getFullYear();
  const m = String(localNow.getMonth() + 1).padStart(2, "0");
  const d = String(localNow.getDate()).padStart(2, "0");
  const yy = String(y).slice(-2);

  return {
    iso: `${y}-${m}-${d}`,     // YYYY-MM-DD
    us:  `${m}/${d}/${y}`,     // MM/DD/YYYY
    parts: { day: d, month: m, year2: yy, year4: String(y) },
    dmY_dots:  `${d}.${m}.${yy}`, // 23.09.25
    dmY_slash: `${d}/${m}/${yy}`, // 23/09/25
  };
}

// Fecha de HOY (sin sumar días), en la misma forma
function todayTZ(tz = "America/Guayaquil") {
  return addDaysTZ(0, tz);
}

/* === NUEVO: extraer Salesforce OppIds desde links === */
/* === NUEVO: extraer Salesforce OppIds desde links (robusto) === */
function extractSFIds(mapeoCampos) {
  const urls = [];
  const ids = [];

  // Parsear un valor (puede traer 1+ links separados por espacio/coma/nueva línea)
  const parseOne = (raw) => {
    if (!raw) return;
    const s = String(raw).trim();
    if (!s) return;

    // Si un campo trae varios links en una sola cadena
    const parts = s.split(/[\s,;]+/).filter(Boolean);

    for (let p of parts) {
      // Si no trae protocolo pero parece dominio, asumimos https
      if (!/^https?:\/\//i.test(p) && /[\w-]+\.[\w.-]+/.test(p)) {
        p = `https://${p}`;
      }

      // Guardamos la URL si ya parece URL
      if (/^https?:\/\//i.test(p)) {
        urls.push(p);
      }

      // Intentar extraer OpportunityId (siempre empieza con 006 y tiene 15 o 18 chars)
      // 1) Lightning: /lightning/r/Opportunity/006.../view
      let m =
        p.match(/\/lightning\/r\/(?:\w+\/)?(006[0-9A-Za-z]{12}(?:[0-9A-Za-z]{3})?)\b/) ||
        // 2) Query param ?id=006...
        p.match(/[?&](?:id|Id|ID)=(006[0-9A-Za-z]{12}(?:[0-9A-Za-z]{3})?)\b/) ||
        // 3) Clásico: .../006... (corta al final de segmento)
        p.match(/\/(006[0-9A-Za-z]{12}(?:[0-9A-Za-z]{3})?)(?:[/?#]|$)/);

      if (m) ids.push(m[1]);
    }
  };

  // Recorremos los CF normalizados: Url_Oportunidad_Sf, Url_Op2, Url_Op3, etc.
  for (const [key, rawVal] of Object.entries(mapeoCampos)) {
    const k = key.toLowerCase();
    const esCampoUrlDeOp =
      k.includes('url') && (k.includes('oportunidad') || /\bop\d*\b/.test(k));
    if (!esCampoUrlDeOp) continue;

    if (Array.isArray(rawVal)) rawVal.forEach(parseOne);
    else parseOne(rawVal);
  }

  // Quitamos duplicados preservando orden
  const dedupe = (arr) => Array.from(new Set(arr.filter(Boolean)));
  return { urls: dedupe(urls), ids: dedupe(ids) };
}


/** ======================================= **/

/* ================= Diccionarios negocio ================= */
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
  "1291299": "WEB LC",
};
const COT_CHINA = {
  "1289523": "Proveedor Cliente",
  "1289525": "Cotizador",
  "1289527": "Vendedor",
  "1289529": "Recotizado",
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
  "59561095": "SERVICIOS CAMARA",
};
const TIPOS_BY_ID = {
  "1284399": "Negocio Existente",
  "1276028": "Negocio Nuevo 1",
  "1284403": "Negocio Nuevo 2",
  "1287460": "Asignado",
  "1287462": "Recuperado",
};
const TIPOS_BY_NAME = Object.fromEntries(
  Object.entries(TIPOS_BY_ID).map(([id, nombre]) => [norm(nombre), { id, nombre }])
);

/* ==== ASESORES (Kommo) por ID → Nombre ==== */
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
  "1291073": "Veyda Pinela",
  "1292851": "María José Rosas"
};

/* === Kommo → Vendedor (Salesforce “corto”) === */
const VENDEDOR_SF = (() => {
  const base = {
    "denisse de la cruz": "Denisse",
    "sami cachiguango": "Sami",
    "damaris nacato": "Damaris",
    "damaris ñacato": "Damaris",
    "daniel benitez": "Daniel",
    "marly moran": "Marly",
    "margarita carpio": "Margarita",
    "gabriela nunez": "Gabriela",
    "gabriela nuñez": "Gabriela",
    "ivis anchundia": "Ivis",
    "jhonny lopez": "Jhonny",
    "araceli gonzales": "Araceli",
    "veyda pinela": "Veyda",
    "alibox": "Alibox",
    "karina vivas": "Karina",
    "maría josé rosas": "María José Rosas"
  };
  return Object.fromEntries(Object.entries(base).map(([k, v]) => [norm(k), v]));
})();

/* === Códigos oficiales por nombre Kommo === */
const ASESORES_KOMMO_CODE = {
  "Denisse de la Cruz": "01",
  "Sami Cachiguango": "11",
  "Daniel Benitez": "06",
  "Marly Moran": "04",
  "Margarita Carpio": "02",
  "Pablo Jara": "10",
  "Gabriela Nuñez": "03",
  "Ivis Anchundia": "13",
  "Jhonny López": "09",
  "Alibox": "07",
  "Damaris Ñacato": "14",
  "Veyda Pinela": "15",
  "Karina Vivas": "05",
  "María José Rosas": "08",
};
const ASESORES_KOMMO_CODE_NORM = Object.fromEntries(
  Object.entries(ASESORES_KOMMO_CODE).map(([name, code]) => [norm(name), code])
);
const VENDEDOR_SHORT_TO_CODE = {
  Denisse: "01",
  Sami: "11",
  Daniel: "06",
  Marly: "04",
  Margarita: "02",
  Pablo: "10",
  Gabriela: "03",
  Ivis: "13",
  Jhonny: "09",
  Alibox: "07",
  Damaris: "14",
  Veyda: "15",
  Karina: "05",
  "María José Rosas": "08",
};
function resolveAsesorCodigo(asesorLargo, vendedorCorto) {
  if (VENDEDOR_SHORT_TO_CODE[vendedorCorto]) return VENDEDOR_SHORT_TO_CODE[vendedorCorto];
  const n = norm(asesorLargo || "");
  if (ASESORES_KOMMO_CODE_NORM[n]) return ASESORES_KOMMO_CODE_NORM[n];
  if (n.includes("no asignado")) return "05";
  return "00";
}

/* ================= Kommo auth & fetch ================= */
let ACCESS_TOKEN = null, ACCESS_TOKEN_EXP = 0;

async function getAccessToken() {
  if (!process.env.KOMMO_API_TOKEN) {
    throw new Error("Missing KOMMO_API_TOKEN");
  }
  return process.env.KOMMO_API_TOKEN;
}




async function refreshAccessToken(subdomain) {
  const url = `https://${subdomain}.kommo.com/oauth2/access_token`;
  const body = {
    client_id: process.env.KOMMO_CLIENT_ID,
    client_secret: process.env.KOMMO_CLIENT_SECRET,
    grant_type: "refresh_token",
    refresh_token: process.env.KOMMO_REFRESH_TOKEN,
    redirect_uri: process.env.KOMMO_REDIRECT_URI,
  };
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`Kommo refresh failed ${r.status}`);
  const data = await r.json();
  ACCESS_TOKEN = data.access_token;
  ACCESS_TOKEN_EXP = Date.now() + (data.expires_in || 3600) * 1000;
  return ACCESS_TOKEN;
}

// GET lead con contactos
async function fetchLeadFull(subdomain, id) {
  const token = await getAccessToken(subdomain);
  const base = `https://${subdomain}.kommo.com/api/v4`;
  const headers = { Authorization: `Bearer ${token}`, Accept: "application/json" };
  const leadId = encodeURIComponent(String(id).trim());

  let r = await fetch(`${base}/leads/${leadId}?with=contacts`, { headers });
  if (r.status === 404) {
    const r2 = await fetch(`${base}/leads?with=contacts&filter[id]=${leadId}`, { headers });
    if (!r2.ok) throw new Error(`Kommo filter GET failed ${r2.status}`);
    const data = await r2.json();
    const lead = data?._embedded?.leads?.[0];
    if (!lead) throw new Error(`Kommo lead ${id} not found`);
    return lead;
  }
  if (!r.ok) throw new Error(`Kommo GET lead ${id} failed ${r.status}`);
  return await r.json();
}

async function fetchUserName(subdomain, userId) {
  if (!userId) return null;
  const token = await getAccessToken(subdomain);
  const base = `https://${subdomain}.kommo.com/api/v4`;
  const headers = { Authorization: `Bearer ${token}`, Accept: "application/json" };
  const uid = encodeURIComponent(String(userId).trim());
  let r = await fetch(`${base}/users/${uid}`, { headers });
  if (r.status === 404) {
    const r2 = await fetch(`${base}/users?filter[id]=${uid}`, { headers });
    if (!r2.ok) return null;
    const data = await r2.json();
    return data?._embedded?.users?.[0]?.name || null;
  }
  if (!r.ok) return null;
  const data = await r.json();
  return data?.name || null;
}

// Contactos por IDs
async function fetchContactsByIds(subdomain, ids) {
  if (!ids?.length) return [];
  const token = await getAccessToken(subdomain);
  const base = `https://${subdomain}.kommo.com/api/v4`;
  const headers = { Authorization: `Bearer ${token}`, Accept: "application/json" };
  const idList = ids.join(",");
  const r = await fetch(`${base}/contacts?filter[id]=${encodeURIComponent(idList)}`, { headers });
  if (!r.ok) throw new Error(`Kommo GET contacts failed ${r.status}`);
  const data = await r.json();
  return data?._embedded?.contacts || [];
}

function extractPhonesEmailsFromContact(contact) {
  const out = { phones: [], emails: [] };
  const arr = contact?.custom_fields_values || [];
  for (const cf of arr) {
    if (cf.field_code === "PHONE") {
      for (const v of (cf.values || [])) if (v?.value) out.phones.push(toStr(v.value));
    }
    if (cf.field_code === "EMAIL") {
      for (const v of (cf.values || [])) if (v?.value) out.emails.push(toStr(v.value));
    }
  }
  return out;
}

/* ====== Definiciones de CF (para traducir enum_id → label) ====== */
let CF_CACHE = { ts: 0, byId: {}, byIdType: {}, byIdLabel: {} };

async function ensureLeadFieldDefs(subdomain, getTokenFn) {
  const MAX_AGE = 10 * 60 * 1000;
  if (Date.now() - CF_CACHE.ts < MAX_AGE && Object.keys(CF_CACHE.byId).length)
    return CF_CACHE;

  const token = await getTokenFn(subdomain);
  const headers = { Authorization: `Bearer ${token}` };
  let page = 1;
  const byId = {}, byType = {}, byLabel = {};
  while (true) {
    const url = `https://${subdomain}.kommo.com/api/v4/leads/custom_fields?page=${page}`;
    const r = await fetch(url, { headers });
    if (!r.ok) throw new Error(`GET custom_fields ${r.status}`);
    const data = await r.json();
    const items = data?._embedded?.custom_fields || [];
    for (const f of items) {
      byType[String(f.id)] = f.type;
      byLabel[String(f.id)] = f.name;
      if (Array.isArray(f.enums)) {
        byId[String(f.id)] = {};
        for (const e of f.enums) byId[String(f.id)][String(e.id)] = e.value;
      }
    }
    if (data?._links?.next?.href) page += 1;
    else break;
  }
  CF_CACHE = { ts: Date.now(), byId, byIdType: byType, byIdLabel: byLabel };
  return CF_CACHE;
}

/* ====== Razones de pérdida (cache) ====== */
let LOSS_CACHE = { ts: 0, byId: {} };

async function ensureLossReasons(subdomain, getTokenFn) {
  const MAX_AGE = 10 * 60 * 1000; // 10 min
  if (Date.now() - LOSS_CACHE.ts < MAX_AGE && Object.keys(LOSS_CACHE.byId).length) {
    return LOSS_CACHE;
  }
  const token = await getAccessToken(subdomain);
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' };
  const url = `https://${subdomain}.kommo.com/api/v4/leads/loss_reasons`;
  const r = await fetch(url, { headers });
  if (!r.ok) throw new Error(`GET loss_reasons ${r.status}`);
  const data = await r.json();
  const byId = {};
  const items = data?._embedded?.loss_reasons || [];
  for (const it of items) byId[String(it.id)] = it.name || '';
  LOSS_CACHE = { ts: Date.now(), byId };
  return LOSS_CACHE;
}



/* ================= Endpoints “legacy” ================= */
app.post("/mapear", (req, res) => {
  const input = req.body;

  const campaniaIds = splitIds(input.campania_enum_ids);
  const campaniaId = firstMatchFromList(campaniaIds, CAMPANAS);
  const campaniaNombre = campaniaId ? CAMPANAS[campaniaId] : "Desconocido";

  const cotChinaId =
    firstMatchFromList(splitIds(input.cot_china_enum), COT_CHINA) ||
    firstIdInFreeText(input.cot_china_enum, COT_CHINA);
  const cotChinaNombre = cotChinaId ? COT_CHINA[cotChinaId] : "";

  const etapaId = toStr(input.etapa_id);
  const etapaLegible = ETAPAS[etapaId] || "Etapa desconocida";

  const tipoValores = splitIds(input.tipo_enum_ids);
  let tipoId = null, tipoNombre = "Desconocido";
  for (const v of tipoValores) {
    if (TIPOS_BY_ID[v]) { tipoId = v; tipoNombre = TIPOS_BY_ID[v]; break; }
    const n = norm(v);
    if (TIPOS_BY_NAME[n]) { tipoId = TIPOS_BY_NAME[n].id; tipoNombre = TIPOS_BY_NAME[n].nombre; break; }
  }

  const inAsesorId = toStr(input.asesor_id);
  const inAsesorTexto = toStr(input.asesor_texto);
  let asesorId = null, asesorNombre = "No encontrado";
  if (ASESORES[inAsesorId]) { asesorId = inAsesorId; asesorNombre = ASESORES[inAsesorId]; }
  else {
    const found = firstIdInFreeText(inAsesorTexto, ASESORES);
    if (found) { asesorId = found; asesorNombre = ASESORES[found]; }
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
    Asesor_Nombre: asesorNombre,
  });
});

const DICCIONARIOS = {
  campanas: CAMPANAS, cot_china: COT_CHINA, etapas: ETAPAS, tipos: TIPOS_BY_ID, asesores: ASESORES,
};
app.get("/lookup/:diccionario/:id", (req, res) => {
  const dic = DICCIONARIOS[req.params.diccionario.toLowerCase()];
  if (!dic) return res.status(400).json({ error: "Diccionario no válido" });
  const val = dic[req.params.id];
  if (!val) return res.status(404).json({ error: "ID no encontrado" });
  res.json({ id: req.params.id, nombre: val });
});

/* ============== /kommo/translate ============== */
app.post("/kommo/translate", async (req, res) => {
  try {
    if (req.query.debug === "1") {
      return res.json({ ok: true, received: req.body });
    }

    const payload = req.body || {};
    const leadsIn = pickLeads(payload);
    const accountIn = pickAccount(payload) || {};
    const subdomain = (accountIn?.subdomain || process.env.KOMMO_SUBDOMAIN || "").trim();

    // definiciones de campos (para nombres y enums)
    let defs = null;
    if (subdomain) {
      try { defs = await ensureLeadFieldDefs(subdomain, getAccessToken); }
      catch (e) { console.warn("No se pudieron cargar definiciones de CF:", e.message); }
    }

    // razones de pérdida (para mapear id -> nombre)
    let lossDefs = { byId: {} };
    if (subdomain) {
      try { lossDefs = await ensureLossReasons(subdomain, getAccessToken); }
      catch (e) { console.warn("No se pudieron cargar razones de pérdida:", e.message); }
    }

    // Config TZ y fecha de cierre
    const closeDays = Number(process.env.SF_CLOSE_DAYS || req.query.close_days || 7);
    const tz        = (process.env.SF_TZ || req.query.tz || "America/Guayaquil").trim();

    const closeCalc = addDaysTZ(closeDays, tz);
    const todayCalc = todayTZ(tz); // ← HOY

    const outLeads = [];
    for (const l of leadsIn) {
      let lead = { ...l };

      // enriquecer si faltan datos clave
      const missingCFs = !lead?.custom_fields && !lead?.custom_fields_values;
      const needsEnrich = !(lead?.responsible_user_id) || missingCFs || !lead?._embedded?.contacts;
      if (needsEnrich && lead?.id && subdomain) {
        try {
          const full = await fetchLeadFull(subdomain, lead.id);
          lead = {
            ...full,
            ...lead,
            id: full.id || lead.id,
            status_id: lead.status_id || full.status_id,
            pipeline_id: lead.pipeline_id || full.pipeline_id,
          };
        } catch (e) {
          console.warn("Enrichment failed for lead", l.id, e.message);
        }
      }

      const status_id = toStr(lead.status_id);
      const responsible_user_id = toStr(lead.responsible_user_id);
      const custom_fields = normalizeCFs(lead);

      // Etapa + Asesor (por responsible_user_id; si no, luego usamos CF)
      let Etapa_Legible = ETAPAS[status_id] || "Etapa desconocida";
      let Asesor_Nombre = ASESORES[responsible_user_id] || "No encontrado";
      if (Asesor_Nombre === "No encontrado" && subdomain && responsible_user_id) {
        const fetched = await fetchUserName(subdomain, responsible_user_id);
        if (fetched) Asesor_Nombre = fetched;
      }

      // === Contacto principal: teléfonos / emails ===
      let Telefono_Principal = "";
      let Telefono_Principal_Clean = "";
      let Telefonos = [];
      let Telefonos_Clean = [];
      let Email_Principal = "";
      let Contacto_Nombre = "";
      let Contacto_Id = null;

      try {
        const links = lead?._embedded?.contacts || [];
        const contactIds = links.map(c => c.id).filter(Boolean);
        const mainId = links.find(c => c.is_main)?.id || contactIds[0];

        if (contactIds.length && subdomain) {
          const contacts = await fetchContactsByIds(subdomain, contactIds);
          const main = contacts.find(c => String(c.id) === String(mainId)) || contacts[0];
          if (main) {
            const { phones, emails } = extractPhonesEmailsFromContact(main);
            Telefonos = phones;
            Telefonos_Clean = phones.map(cleanEcPhone).filter(Boolean);
            Telefono_Principal = phones[0] || "";
            Telefono_Principal_Clean = cleanEcPhone(Telefono_Principal);
            Email_Principal = emails[0] || "";
            Contacto_Nombre = main.name || "";
            Contacto_Id = main.id || null;
          }
        }
      } catch (e) {
        console.warn("Contacts enrich failed for lead", l.id, e.message);
      }

      // Construimos salida “bonita” para TODOS los CF
      const fields_pretty = [];
      const mapeoCampos = {};

      for (const cf of custom_fields) {
        const fieldId = String(cf.id);
        const fieldType = defs?.byIdType?.[fieldId] || "";
        const fieldLabel = defs?.byIdLabel?.[fieldId] || `CF_${fieldId}`;
        const key = keyify(fieldLabel);

        const values = Array.isArray(cf.values) ? cf.values : [];
        const rawValues = values
          .map((v) => (v?.value !== undefined ? v.value : null))
          .filter((v) => v !== null);

        if (fieldType === "select") {
          const { value, enum_id } = cfFirst(cf);
          const enumName = enum_id ? defs?.byId?.[fieldId]?.[String(enum_id)] || null : null;

          fields_pretty.push({
            field_id: fieldId, name: fieldLabel, type: fieldType, value, enum_id, enum_name: enumName,
          });

          mapeoCampos[`${key}_Id`] = enum_id ?? null;
          mapeoCampos[`${key}_Nombre`] = enumName ?? (value ?? "");
          mapeoCampos[`${key}_Value`] = value ?? "";
        } else if (fieldType === "multiselect") {
          const enumIds = values
            .map((v) => (v?.enum_id !== undefined ? String(v.enum_id) : null))
            .filter(Boolean);
          const enumNames = enumIds.map((id) => defs?.byId?.[fieldId]?.[id] || "");

          fields_pretty.push({
            field_id: fieldId, name: fieldLabel, type: fieldType,
            enum_ids: enumIds, enum_names: enumNames, value: rawValues[0] ?? null,
          });

          mapeoCampos[`${key}_Ids`] = enumIds;
          mapeoCampos[`${key}_Nombres`] = enumNames;
        } else {
          const value = rawValues.length > 1 ? rawValues : rawValues[0] ?? "";
          fields_pretty.push({ field_id: fieldId, name: fieldLabel, type: fieldType || "text", value });
          mapeoCampos[key] = value;
        }
      }

      // === NUEVO: extraer Opps de SF desde los CF ya normalizados ===
    const { urls: OppUrls, ids: OppIds } = extractSFIds(mapeoCampos);

    // Resolver Tipo (ID o texto)
    let Tipo_Id = null, Tipo_Nombre = "Desconocido";
    const maybeTipo = mapeoCampos["Tipo_Id"] ?? mapeoCampos["Tipo"] ?? null;
    if (maybeTipo) {
      const isNum = !isNaN(Number(maybeTipo));
      if (isNum) {
        Tipo_Id = String(maybeTipo);
        Tipo_Nombre = TIPOS_BY_ID[Tipo_Id] || "Desconocido";
      } else {
        const n = norm(maybeTipo);
        if (TIPOS_BY_NAME[n]) {
          Tipo_Id = TIPOS_BY_NAME[n].id;
          Tipo_Nombre = TIPOS_BY_NAME[n].nombre;
        } else {
          Tipo_Nombre = String(maybeTipo);
        }
      }
    }

    const stageMapSF = {
      "Contacto inicial": "Qualification",
      "DEFINICION DE LISTA": "Prospecting",
      "COTIZA EL ASESOR": "Proposal/Price Quote",
      "COTIZA EL CLIENTE": "Negotiation/Review",
      LIQUIDADO: "Closed Won",
      "VENTA CONCRETADA": "Closed Won",
    };
    const StageName_SF = stageMapSF[Etapa_Legible] || "Qualification";

    // --- Elegir mejor fuente para Asesor y calcular Vendedor SF ---
    const asesorPorResp = Asesor_Nombre;
    const asesorPorCF   = toStr(mapeoCampos.Asesor_Nombre || mapeoCampos.Asesor_Value || "");
    const mapsResp = !!VENDEDOR_SF[norm(asesorPorResp)];
    const mapsCF   = !!VENDEDOR_SF[norm(asesorPorCF)];

    let asesorBueno = asesorPorResp;
    if ((!mapsResp || norm(asesorPorResp) === "marketing" || asesorPorResp === "No encontrado") && asesorPorCF) {
      asesorBueno = asesorPorCF;
    }
    const Vendedor = VENDEDOR_SF[norm(asesorBueno)] || "";
    const Vendedor_Kommo = asesorBueno;
    const Asesor_Codigo = resolveAsesorCodigo(asesorBueno, Vendedor);

    // Razón de pérdida
    const Motivo_Perdida_Id = lead?.loss_reason_id ?? null;
    const Motivo_Perdida_Nombre = Motivo_Perdida_Id
      ? (lossDefs.byId[String(Motivo_Perdida_Id)] || "")
      : "";

    // También reflejamos PHONE/EMAIL como “system” en fields_pretty
    fields_pretty.push({ name: "PHONE", type: "system", value: Telefono_Principal });
    fields_pretty.push({ name: "EMAIL", type: "system", value: Email_Principal });

    // IMPORTANTE: primero los mapeos de CF (mapeoCampos), luego calculados
    outLeads.push({
      ...l,
      responsible_user_id,
      custom_fields,
      fields_pretty,
      mapeo: {
        // 1) CF "bonitos"
        ...mapeoCampos,

        // 2) Calculados
        Etapa_Legible,
        Asesor_Nombre: asesorBueno,
        Vendedor,
        Vendedor_Kommo,
        Asesor_Codigo,
        StageName_SF,
        Tipo_Id,
        Tipo_Nombre,

        // Contacto principal
        Contacto_Id,
        Contacto_Nombre,
        Telefono: Telefono_Principal,
        Telefono_Clean: Telefono_Principal_Clean,
        Telefonos,
        Telefonos_Clean,
        Email_Principal,

        // Fecha de cierre
        Fecha_Cierre_ISO: closeCalc.iso,
        Fecha_Cierre_MDY: closeCalc.us,

        // Fecha de HOY (día actual)
        Hoy_ISO:   todayCalc.iso,
        Hoy_MDY:   todayCalc.us,
        Hoy_Dia:   todayCalc.parts.day,
        Hoy_Mes:   todayCalc.parts.month,
        Hoy_Anio2: todayCalc.parts.year2,
        Hoy_Anio4: todayCalc.parts.year4,
        Hoy_Dot:   todayCalc.dmY_dots,
        Hoy_Slash: todayCalc.dmY_slash,

        // === NUEVOS para cierre en Salesforce ===
        Oportunidades_SF_Urls: OppUrls,
        Oportunidades_SF_Ids: OppIds,

        // Razón de pérdida (Kommo)
        Motivo_Perdida_Id,
        Motivo_Perdida_Nombre,
      },
    });

    }

    res.json({ ok: true, leads: outLeads, account: accountIn });
  } catch (err) {
    console.error("Error /kommo/translate:", err);
    res.status(500).json({ ok: false, error: "Error interno" });
  }
});

/* ================= Debug Kommo connection ================= */
app.get("/debug/kommo", async (req, res) => {
  const subdomain = process.env.KOMMO_SUBDOMAIN || "no-configurado";
  const tokenExists = !!process.env.KOMMO_API_TOKEN;
  const tokenFirst10 = process.env.KOMMO_API_TOKEN ? process.env.KOMMO_API_TOKEN.slice(0, 10) + "..." : "no-token";
  const tokenLength = process.env.KOMMO_API_TOKEN ? process.env.KOMMO_API_TOKEN.length : 0;
  
  let apiTest = { status: "not-tested", message: "" };
  
  if (tokenExists && subdomain !== "no-configurado") {
    try {
      const token = process.env.KOMMO_API_TOKEN;
      const url = `https://${subdomain}.kommo.com/api/v4/account`;
      const r = await fetch(url, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }
      });
      if (r.ok) {
        const data = await r.json();
        apiTest = { status: "ok", message: `Conectado a cuenta: ${data.name || data.id}` };
      } else {
        apiTest = { status: "error", message: `HTTP ${r.status} - ${r.statusText}` };
      }
    } catch (e) {
      apiTest = { status: "error", message: e.message };
    }
  }
  
  res.json({
    subdomain,
    tokenExists,
    tokenFirst10,
    tokenLength,
    apiTest
  });
});

/* ================= Root ================= */
app.get("/", (_req, res) => res.send("✅ DiccionarioCESCH API funcionando."));
app.listen(PORT, () => console.log("✅ Servidor corriendo en puerto", PORT));

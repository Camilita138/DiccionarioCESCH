// index.js
const express = require("express");
const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

/* ============== Fetch helper (soporta Node <18) ============== */
const doFetch = (...args) =>
  (globalThis.fetch
    ? globalThis.fetch(...args)
    : import("node-fetch").then(({ default: f }) => f(...args)));

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
};

/* ================= Kommo auth & fetch ================= */
let ACCESS_TOKEN = null, ACCESS_TOKEN_EXP = 0;

async function getAccessToken(subdomain) {
  if (process.env.KOMMO_API_TOKEN) return process.env.KOMMO_API_TOKEN; // sin "Bearer"
  if (ACCESS_TOKEN && Date.now() < ACCESS_TOKEN_EXP - 60_000) return ACCESS_TOKEN;
  if (process.env.KOMMO_REFRESH_TOKEN) return refreshAccessToken(subdomain);
  if (ACCESS_TOKEN) return ACCESS_TOKEN;
  throw new Error("No Kommo token configured");
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
  const r = await doFetch(url, {
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

async function fetchLeadFull(subdomain, id) {
  const token = await getAccessToken(subdomain);
  const base = `https://${subdomain}.kommo.com/api/v4`;
  const headers = { Authorization: `Bearer ${token}`, Accept: "application/json" };
  const leadId = encodeURIComponent(String(id).trim());

  let r = await doFetch(`${base}/leads/${leadId}`, { headers });
  if (r.status === 404) {
    const r2 = await doFetch(`${base}/leads?filter[id]=${leadId}`, { headers });
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

  let r = await doFetch(`${base}/users/${uid}`, { headers });
  if (r.status === 404) {
    const r2 = await doFetch(`${base}/users?filter[id]=${uid}`, { headers });
    if (!r2.ok) return null;
    const data = await r2.json();
    return data?._embedded?.users?.[0]?.name || null;
  }
  if (!r.ok) return null;
  const data = await r.json();
  return data?.name || null;
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
    const r = await doFetch(url, { headers });
    if (!r.ok) throw new Error(`GET custom_fields ${r.status}`);
    const data = await r.json();
    const items = data?._embedded?.custom_fields || [];

    for (const f of items) {
      byType[String(f.id)] = f.type;
      byLabel[String(f.id)] = f.name;
      if (Array.isArray(f.enums)) {
        byId[String(f.id)] = {};
        for (const e of f.enums) {
          byId[String(f.id)][String(e.id)] = e.value;
        }
      }
    }
    if (data?._links?.next?.href) page += 1;
    else break;
  }
  CF_CACHE = { ts: Date.now(), byId, byIdType: byType, byIdLabel: byLabel };
  return CF_CACHE;
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
  if (ASESORES[inAsesorId]) {
    asesorId = inAsesorId;
    asesorNombre = ASESORES[inAsesorId];
  } else {
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
  campanas: CAMPANAS,
  cot_china: COT_CHINA,
  etapas: ETAPAS,
  tipos: TIPOS_BY_ID,
  asesores: ASESORES,
};
app.get("/lookup/:diccionario/:id", (req, res) => {
  const dic = DICCIONARIOS[req.params.diccionario.toLowerCase()];
  if (!dic) return res.status(400).json({ error: "Diccionario no válido" });
  const val = dic[req.params.id];
  if (!val) return res.status(404).json({ error: "ID no encontrado" });
  res.json({ id: req.params.id, nombre: val });
});

/* ================= /kommo/translate (TODOS los CF) ================= */
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

    const outLeads = [];
    for (const l of leadsIn) {
      let lead = { ...l };

      // enriquecer si faltan datos clave
      const missingCFs = !lead?.custom_fields && !lead?.custom_fields_values;
      const needsEnrich = !(lead?.responsible_user_id) || missingCFs;
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

      // Etapa + Asesor
      const Etapa_Legible = ETAPAS[status_id] || "Etapa desconocida";
      let Asesor_Nombre = ASESORES[responsible_user_id] || "No encontrado";
      if (Asesor_Nombre === "No encontrado" && subdomain && responsible_user_id) {
        const fetched = await fetchUserName(subdomain, responsible_user_id);
        if (fetched) Asesor_Nombre = fetched;
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
            field_id: fieldId, name: fieldLabel, type: fieldType,
            value, enum_id, enum_name: enumName,
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
            enum_ids: enumIds, enum_names: enumNames,
            value: rawValues[0] ?? null,
          });

          mapeoCampos[`${key}_Ids`] = enumIds;
          mapeoCampos[`${key}_Nombres`] = enumNames;
        } else {
          const value = rawValues.length > 1 ? rawValues : rawValues[0] ?? "";
          fields_pretty.push({
            field_id: fieldId, name: fieldLabel, type: fieldType || "text", value,
          });
          mapeoCampos[key] = value;
        }
      }

      // Tipo (flexible por si viene en texto/ID)
      let Tipo_Id = null, Tipo_Nombre = "Desconocido";
      const maybeTipo = mapeoCampos["Tipo_Id"] ?? mapeoCampos["Tipo"] ?? null;
      if (maybeTipo) {
        const isNum = !isNaN(Number(maybeTipo));
        if (isNum) {
          Tipo_Id = String(maybeTipo);
          Tipo_Nombre = TIPOS_BY_ID[Tipo_Id] || "Desconocido";
        } else {
          const n = norm(maybeTipo);
          if (TIPOS_BY_NAME[n]) { Tipo_Id = TIPOS_BY_NAME[n].id; Tipo_Nombre = TIPOS_BY_NAME[n].nombre; }
          else { Tipo_Nombre = String(maybeTipo); }
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

      outLeads.push({
        ...l,
        responsible_user_id,
        custom_fields,
        fields_pretty, // ← TODOS los campos con su field_id y nombres
        mapeo: {
          Etapa_Legible,
          Asesor_Nombre,
          StageName_SF,
          Tipo_Id, Tipo_Nombre,
          ...mapeoCampos, // ← claves “bonitas” para usar directo
        },
      });
    }

    res.json({ ok: true, leads: outLeads, account: accountIn });
  } catch (err) {
    console.error("Error /kommo/translate:", err);
    res.status(500).json({ ok: false, error: "Error interno" });
  }
});

/* ============== /utils/prepare (teléfono + nombre) ============== */
app.post("/utils/prepare", (req, res) => {
  try {
    const raw = toStr(req.body.raw_number).trim();
    const full = toStr(req.body.full_name).trim();

    // Teléfono Ecuador: busca primer match y normaliza a 0XXXXXXXXX
    let numero = null;
    const re = /(?:(?:\+593|593)\s*)?0?\d{9}/;
    for (const p of raw.split(",")) {
      const m = toStr(p).trim().match(re);
      if (m) { numero = m[0]; break; }
    }
    let cleaned = "";
    if (numero) {
      cleaned = numero.replace(/\s+/g, "");
      cleaned = cleaned.replace(/^\+?5930?/, "0"); // +593… / 593… → 0…
    }
    const number_length = cleaned.length;

    // Nombre: si viene con "_" lo tratamos como persona (FIRST_LAST)
    let normalized_name = "";
    let short_name = "NC";
    if (full) {
      if (full.includes("_")) {
        const parts = full.replace(/_/g, " ").trim().split(/\s+/);
        const first = parts[0] || "";
        const last  = parts.length > 1 ? parts[parts.length - 1] : "";
        normalized_name = `${last} ${first}`.trim().toUpperCase();
        short_name = (last && first) ? (last[0] + first[0]).toUpperCase() : "NC";
      } else {
        // Empresa: respétalo (solo lo pasamos a mayúsculas para normalized_name)
        normalized_name = full.toUpperCase();
        short_name = "NC";
      }
    }

    res.json({
      ok: true,
      cleaned_number: cleaned,
      number_length,
      normalized_name,
      short_name
    });
  } catch (e) {
    console.error("Error /utils/prepare:", e);
    res.status(500).json({ ok: false, error: "Error interno" });
  }
});

/* ================= Root ================= */
app.get("/", (_req, res) => res.send("✅ DiccionarioCESCH API funcionando."));
app.listen(PORT, () => console.log("✅ Servidor corriendo en puerto", PORT));

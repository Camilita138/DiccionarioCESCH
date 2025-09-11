// index.js
const express = require("express");
const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

/* ========================= Helpers ========================= */

const toStr = (v) => (v ?? "").toString();
const NORM = (s) =>
  toStr(s).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

const splitIds = (s) => toStr(s).split(",").map((x) => x.trim()).filter(Boolean);
const firstMatchFromList = (arr, mapObj) => arr.find((id) => mapObj[id]) || null;
const firstIdInFreeText = (text, mapObj) => {
  const ids = toStr(text).match(/\d+/g) || [];
  return firstMatchFromList(ids, mapObj);
};

// Normaliza CFs de Kommo (v4) a { id, values } como usa el resto del código
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

// Extrae un custom field (forma normalizada {id, values})
const getCF = (arr, targetId) => {
  if (!Array.isArray(arr)) return null;
  const f = arr.find((x) => String(x.id) === String(targetId));
  const val = f?.values?.[0]?.value;
  return val === "" || val === undefined ? null : val;
};

// Versión extendida: devuelve value/enum_id/enum_ids para select/multiselect
const getCFx = (arr, targetId) => {
  if (!Array.isArray(arr)) return { value: null, enum_id: null, enum_ids: [] };
  const f = arr.find((x) => String(x.id) === String(targetId));
  const v = f?.values?.[0] || {};
  const enumIds = Array.isArray(f?.values)
    ? f.values.map((x) => x?.enum_id).filter(Boolean)
    : [];
  return { value: v.value ?? null, enum_id: v.enum_id ?? null, enum_ids: enumIds };
};

// Convierte "URL carpeta del Cliente" -> "Url_Carpeta_Del_Cliente"
const keyify = (label) =>
  NORM(label)
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("_");

// Acepta distintas formas del payload (leads, leads.status, status, payload.*)
function pickLeads(body) {
  const asArray = (v) => (Array.isArray(v) ? v : v && typeof v === "object" ? [v] : []);
  if (Array.isArray(body?.leads)) return body.leads; // { leads: [...] }
  if (body?.leads?.status) return asArray(body.leads.status); // { leads: { status: [...] } }
  if (Array.isArray(body?.status)) return body.status; // { status: [...] }
  if (body?.status) return asArray(body.status);
  if (Array.isArray(body?.payload?.leads)) return body.payload.leads; // { payload: { leads: [...] } }
  if (body?.payload?.leads?.status) return asArray(body.payload.leads.status);
  return [];
}
function pickAccount(body) {
  return body?.account || body?.payload?.account || null;
}

/* ========================= Diccionarios (negocio) ========================= */

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
  Object.entries(TIPOS_BY_ID).map(([id, nombre]) => [NORM(nombre), { id, nombre }])
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

/* ========================= Auth & fetch Kommo ========================= */
// Soporta API KEY (recomendado) y OAuth refresh si existiera.
let ACCESS_TOKEN = null,
  ACCESS_TOKEN_EXP = 0;

// Usa API KEY si está; si no, intenta OAuth (si hay refresh token)
async function getAccessToken(subdomain) {
  if (process.env.KOMMO_API_TOKEN) return process.env.KOMMO_API_TOKEN; // SIN "Bearer"
  if (ACCESS_TOKEN && Date.now() < ACCESS_TOKEN_EXP - 60_000) return ACCESS_TOKEN;
  if (process.env.KOMMO_REFRESH_TOKEN) return refreshAccessToken(subdomain);
  if (ACCESS_TOKEN) return ACCESS_TOKEN;
  throw new Error("No Kommo token configured (set KOMMO_API_TOKEN or OAuth envs)");
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

// GET lead completo; si /leads/{id} da 404, prueba /leads?filter[id]=
async function fetchLeadFull(subdomain, id) {
  const token = await getAccessToken(subdomain);
  const base = `https://${subdomain}.kommo.com/api/v4`;
  const headers = { Authorization: `Bearer ${token}`, Accept: "application/json" };
  const leadId = encodeURIComponent(String(id).trim());

  let r = await fetch(`${base}/leads/${leadId}`, { headers });
  if (r.status === 404) {
    const r2 = await fetch(`${base}/leads?filter[id]=${leadId}`, { headers });
    if (!r2.ok) throw new Error(`Kommo filter GET failed ${r2.status}`);
    const data = await r2.json();
    const lead = data?._embedded?.leads?.[0];
    if (!lead) throw new Error(`Kommo lead ${id} not found by filter`);
    return lead;
  }
  if (!r.ok) throw new Error(`Kommo GET lead ${id} failed ${r.status}`);
  return await r.json();
}

// Si el asesor no está en tu diccionario, intenta leerlo de Kommo
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

/* ====== Auto-diccionarios de Custom Fields (descarga y cachea) ====== */

let CF_CACHE = { ts: 0, byId: {}, byIdType: {}, byIdLabel: {} }; // { [fieldId]: { [enum_id]: "Label" } }

async function ensureLeadFieldDefs(subdomain, getAccessTokenFn) {
  const MAX_AGE = 10 * 60 * 1000; // 10 minutos
  if (Date.now() - CF_CACHE.ts < MAX_AGE && Object.keys(CF_CACHE.byId).length)
    return CF_CACHE;

  const token = await getAccessTokenFn(subdomain);
  let page = 1,
    done = false;
  const byId = {},
    byType = {},
    byLabel = {};

  while (!done) {
    const url = `https://${subdomain}.kommo.com/api/v4/leads/custom_fields?page=${page}`;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) throw new Error(`GET custom_fields ${r.status}`);
    const data = await r.json();
    const items = Array.isArray(data?._embedded?.custom_fields)
      ? data._embedded.custom_fields
      : [];
    for (const f of items) {
      byType[String(f.id)] = f.type; // select, multiselect, text, url, numeric, date, ...
      byLabel[String(f.id)] = f.name; // etiqueta visible
      if (Array.isArray(f?.enums)) {
        byId[String(f.id)] = {};
        for (const e of f.enums) {
          byId[String(f.id)][String(e.id)] = e.value; // enum_id -> label
        }
      }
    }
    const hasNext = data?._links?.next?.href;
    if (hasNext) page += 1;
    else done = true;
  }
  CF_CACHE = { ts: Date.now(), byId, byIdType: byType, byIdLabel: byLabel };
  return CF_CACHE;
}

// Usa las definiciones para traducir un CF (select/multiselect/otros)
function mapFromDefs(cfData, defs, fieldId) {
  const enumsMap = defs.byId[String(fieldId)] || {};
  const fieldType = defs.byIdType[String(fieldId)] || "";
  const fieldLabel = defs.byIdLabel[String(fieldId)] || `CF_${fieldId}`;

  // SELECT
  if (fieldType === "select") {
    if (cfData.enum_id && enumsMap[String(cfData.enum_id)]) {
      return {
        key: keyify(fieldLabel),
        id: String(cfData.enum_id),
        name: enumsMap[String(cfData.enum_id)],
      };
    }
    if (cfData.value) {
      const byName = Object.fromEntries(
        Object.entries(enumsMap).map(([id, name]) => [NORM(name), id])
      );
      const n = NORM(cfData.value);
      if (byName[n])
        return { key: keyify(fieldLabel), id: byName[n], name: enumsMap[byName[n]] };
      return { key: keyify(fieldLabel), id: null, name: String(cfData.value) };
    }
    return { key: keyify(fieldLabel), id: null, name: "" };
  }

  // MULTISELECT
  if (fieldType === "multiselect") {
    const ids = (cfData.enum_ids || []).map(String);
    const names = ids.map((id) => enumsMap[id] || "").filter(Boolean);
    return { key: keyify(fieldLabel), ids, names };
  }

  // Otros tipos (texto/url/num/fecha...)
  return { key: keyify(fieldLabel), value: cfData.value ?? "" };
}

/* === Lista de CFs que quieres que salgan “bonitos” (añade todos los que necesites) === */
const CF_EXPORT = [
  { id: "1019903" }, // Campaña (tu campo, label "Campaña" o similar)
  { id: "1021315" }, // Cot China
  { id: "1017119" }, // Tipo
  // Ejemplos que vi en pantalla (verifica IDs exactos en tu JSON/inspector):
  // { id: "100431" }, // URL carpeta del Cliente
  // { id: "100649" }, // URL Oportunidad SF
  // { id: "102246" }, // URL OP2
  // ... añade todos los que quieras
];

/* ========================= Endpoints existentes ========================= */

// POST /mapear (legacy manual)
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
  let tipoId = null,
    tipoNombre = "Desconocido";
  for (const v of tipoValores) {
    if (TIPOS_BY_ID[v]) {
      tipoId = v;
      tipoNombre = TIPOS_BY_ID[v];
      break;
    }
    const n = NORM(v);
    if (TIPOS_BY_NAME[n]) {
      tipoId = TIPOS_BY_NAME[n].id;
      tipoNombre = TIPOS_BY_NAME[n].nombre;
      break;
    }
  }

  const inAsesorId = toStr(input.asesor_id);
  const inAsesorTexto = toStr(input.asesor_texto);
  let asesorId = null,
    asesorNombre = "No encontrado";
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
    Asesor_Nombre: asesorNombre,
  });
});

// GET /lookup/:diccionario/:id
const DICCIONARIOS = {
  campanas: CAMPANAS,
  cot_china: COT_CHINA,
  etapas: ETAPAS,
  tipos: TIPOS_BY_ID,
  asesores: ASESORES,
};
app.get("/lookup/:diccionario/:id", (req, res) => {
  const diccionario = DICCIONARIOS[req.params.diccionario.toLowerCase()];
  const id = req.params.id;
  if (!diccionario) return res.status(400).json({ error: "Diccionario no válido" });
  const valor = diccionario[id];
  if (!valor) return res.status(404).json({ error: "ID no encontrado" });
  res.json({ id, nombre: valor });
});

/* ============== /kommo/translate (enriquece + mapea TODOS los CF) ============== */

app.post("/kommo/translate", async (req, res) => {
  try {
    // Debug opcional: ?debug=1
    if (req.query.debug === "1") {
      return res.json({
        ok: true,
        receivedKeys: Object.keys(req.body || {}),
        sample: req.body,
      });
    }

    const payload = req.body || {};
    const leadsIn = pickLeads(payload);
    const accountIn = pickAccount(payload) || {};
    const subdomain =
      (accountIn?.subdomain || process.env.KOMMO_SUBDOMAIN || "").trim();

    // Auto-diccionarios de CF (para traducir enum_id → label)
    let defs = null;
    if (subdomain) {
      try {
        defs = await ensureLeadFieldDefs(subdomain, getAccessToken);
      } catch (e) {
        console.warn("No se pudieron cargar definiciones de CF:", e.message);
      }
    }

    const outLeads = [];
    for (const l of leadsIn) {
      let lead = { ...l };

      const missingCFs = !lead?.custom_fields && !lead?.custom_fields_values;
      const needsEnrich = !(lead?.responsible_user_id) || missingCFs;
      if (needsEnrich && lead?.id && subdomain) {
        try {
          const full = await fetchLeadFull(subdomain, lead.id);
          // Merge (conserva id/status/pipeline del webhook si ya venían)
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

      /* ====== Etapa + Asesor ====== */
      const Etapa_Legible = ETAPAS[status_id] || "Etapa desconocida";
      let Asesor_Nombre = ASESORES[responsible_user_id] || "No encontrado";
      if (Asesor_Nombre === "No encontrado" && subdomain && responsible_user_id) {
        const fetched = await fetchUserName(subdomain, responsible_user_id);
        if (fetched) Asesor_Nombre = fetched;
      }

      /* ====== Auto-mapeo de CF EXPORTADOS ====== */
      const auto = {};
      if (defs) {
        for (const item of CF_EXPORT) {
          const cf = getCFx(custom_fields, item.id);
          const mapped = mapFromDefs(cf, defs, item.id);

          if ("id" in mapped || "name" in mapped) {
            auto[`${mapped.key}_Id`] = mapped.id ?? null;
            auto[`${mapped.key}_Nombre`] = mapped.name ?? "";
          } else if ("ids" in mapped || "names" in mapped) {
            auto[`${mapped.key}_Ids`] = mapped.ids || [];
            auto[`${mapped.key}_Nombres`] = mapped.names || [];
          } else {
            auto[mapped.key] = mapped.value ?? "";
          }
        }
      }

      /* ====== StageName para SF (ajusta a tu picklist real) ====== */
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
        ...l, // datos tal cual llegaron del webhook
        responsible_user_id,
        custom_fields, // normalizados
        mapeo: {
          Etapa_Legible,
          Pipeline_Nombre: null, // si luego quieres mapear pipeline, añade un diccionario
          Asesor_Nombre,
          StageName_SF,
          ...auto, // aquí vienen TODOS los campos exportados con nombres legibles
        },
      });
    }

    res.json({ ok: true, leads: outLeads, account: accountIn });
  } catch (err) {
    console.error("Error /kommo/translate:", err);
    res.status(500).json({ ok: false, error: "Error interno" });
  }
});

/* ========================= Root & Listen ========================= */

app.get("/", (req, res) => res.send("✅ DiccionarioCESCH API funcionando."));
app.listen(PORT, () => console.log("✅ Servidor corriendo en puerto", PORT));

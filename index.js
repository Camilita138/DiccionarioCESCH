const express = require("express");
const app = express();
const PORT = process.env.PORT || 3000;

// Diccionarios personalizados
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
};

app.get("/", (req, res) => {
  res.send("DiccionarioCESCH API funcionando.");
});

app.get("/campanas/:id", (req, res) => {
  const id = req.params.id;
  const nombre = CAMPANAS[id];
  if (nombre) {
    res.json({ id, nombre });
  } else {
    res.status(404).json({ error: "ID no encontrado" });
  }
});

app.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
});

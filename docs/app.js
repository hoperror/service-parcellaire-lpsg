// === CONFIG ===
const API_FUNC = "https://chairegif.fr/featureserv/functions/jravelonjaka";
const API_COLL = "https://chairegif.fr/featureserv/collections/jravelonjaka";

// === FONDS DE CARTE ===
const basemaps = {
  Plan: L.tileLayer(
    "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
    {
      attribution: "&copy; OSM &copy; CARTO",
      maxZoom: 20,
    },
  ),
  Satellite: L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    {
      attribution: "&copy; Esri",
      maxZoom: 19,
    },
  ),
  OpenStreetMap: L.tileLayer(
    "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    {
      attribution: "&copy; OSM",
      maxZoom: 19,
    },
  ),
};

// === INITIALISATION CARTE ===
const map = L.map("map", {
  center: [48.8867, 2.4025],
  zoom: 16,
  layers: [basemaps["Plan"]],
  fullscreenControl: true,
});

L.control
  .layers(basemaps, null, { position: "topleft", collapsed: true })
  .addTo(map);
L.control
  .scale({ metric: true, imperial: false, position: "bottomleft" })
  .addTo(map);

// === ÉTAT ===
let selectedLayer = null;
let parcellesLayer = null;
let batimentsLayer = null;
let communeLayer = null;
let parcellesUseStats = false;

// === STYLES ===
const defaultStyle = {
  color: "#c0392b",
  weight: 1,
  fillColor: "#f5b7b1",
  fillOpacity: 0.2,
};
const hoverStyle = {
  color: "#c0392b",
  weight: 2,
  fillColor: "#f1948a",
  fillOpacity: 0.4,
};
const selectedStyle = {
  color: "#922b21",
  weight: 3,
  fillColor: "#c0392b",
  fillOpacity: 0.3,
};
const batimentStyle = {
  color: "#34495e",
  weight: 1,
  fillColor: "#34495e",
  fillOpacity: 0.15,
};
const communeStyle = {
  color: "#e67e22",
  weight: 3,
  fillColor: "transparent",
  dashArray: "8 6",
};

// ========================================
//  CHARGEMENT DES COUCHES
// ========================================

async function loadParcelles() {
  let data;
  try {
    const res = await fetch(`${API_COLL}.parcelle_stats/items.json?limit=2000`);
    if (!res.ok) throw new Error("parcelle_stats indisponible");
    data = await res.json();
    parcellesUseStats = true;
  } catch {
    parcellesUseStats = false;
    try {
      data = await (
        await fetch(`${API_COLL}.parcelle/items.json?limit=2000`)
      ).json();
    } catch (err) {
      document.getElementById("parcelle-count").textContent =
        "erreur de chargement";
      return;
    }
  }

  parcellesLayer = L.geoJSON(data, {
    style: defaultStyle,
    onEachFeature: (feature, layer) => {
      const p = feature.properties;

      const tooltipContent = parcellesUseStats
        ? `<div class="parcelle-tooltip">
                      <div class="tt-id">${p.section || ""} ${p.numero || ""}</div>
                      <div class="tt-info">${Math.round(p.surface_m2).toLocaleString("fr-FR")} m² · ${p.nb_batiments} bât. · ratio ${(p.ratio_bati * 100).toFixed(0)}%</div>
                   </div>`
        : `<div class="parcelle-tooltip">
                      <div class="tt-id">${p.section || ""} ${p.numero || ""}</div>
                      <div class="tt-info">${p.id || p.id_parcelle || ""}</div>
                   </div>`;

      layer.bindTooltip(tooltipContent, {
        sticky: true,
        direction: "top",
        offset: [0, -8],
        className: "parcelle-tooltip-wrapper",
      });

      layer.on("mouseover", () => {
        if (layer !== selectedLayer) layer.setStyle(hoverStyle);
      });
      layer.on("mouseout", () => {
        if (layer !== selectedLayer) {
          const metric = document.getElementById("choro-select").value;
          if (metric !== "none" && parcellesUseStats) {
            applyChoroStyleToLayer(layer, metric);
          } else {
            layer.setStyle(defaultStyle);
          }
        }
      });
      layer.on("click", () => {
        const c = layer.getBounds().getCenter();
        searchByLatLng(c.lng, c.lat);
      });
    },
  }).addTo(map);

  map.fitBounds(parcellesLayer.getBounds(), { padding: [20, 20] });
  document.getElementById("parcelle-count").textContent =
    `${data.features.length} parcelles`;

  if (!parcellesUseStats) {
    document.getElementById("choro-select").disabled = true;
    document.getElementById("choro-select").title =
      "Disponible après redémarrage du serveur";
  }

  updateDashboard();
}

async function loadBatiments() {
  if (batimentsLayer) return;
  try {
    const data = await (
      await fetch(`${API_COLL}.batiment/items.json?limit=2000`)
    ).json();
    batimentsLayer = L.geoJSON(data, {
      style: batimentStyle,
      interactive: false,
    });
    batimentsLayer.addTo(map);
    if (parcellesLayer) parcellesLayer.bringToFront();
    if (selectedLayer) selectedLayer.bringToFront();
  } catch (err) {
    console.error("Erreur chargement bâtiments:", err);
  }
}

async function loadCommune() {
  if (communeLayer) return;
  try {
    const data = await (
      await fetch(`${API_COLL}.commune/items.json?limit=1`)
    ).json();
    communeLayer = L.geoJSON(data, { style: communeStyle, interactive: false });
  } catch (err) {
    console.error("Erreur chargement commune:", err);
  }
}

// ========================================
//  TOGGLES COUCHES
// ========================================

function toggleBatiments(btn) {
  btn.classList.toggle("active");
  if (btn.classList.contains("active")) {
    loadBatiments();
  } else if (batimentsLayer) {
    map.removeLayer(batimentsLayer);
    batimentsLayer = null;
  }
}

function toggleCommune(btn) {
  btn.classList.toggle("active");
  if (btn.classList.contains("active")) {
    loadCommune().then(() => {
      if (communeLayer) communeLayer.addTo(map);
    });
  } else if (communeLayer) {
    map.removeLayer(communeLayer);
  }
}

// ========================================
//  CHOROPLÈTHE
// ========================================

const choroColors = [
  "#fef5f1",
  "#fadbd8",
  "#f5b7b1",
  "#f1948a",
  "#e74c3c",
  "#c0392b",
  "#922b21",
];

const choroTitles = {
  surface_m2: "Surface réelle (m²)",
  nb_batiments: "Nombre de bâtiments",
  surface_batie_m2: "Surface bâtie (m²)",
  ratio_bati: "Ratio bâti",
};

function getChoroColor(value, min, max) {
  if (value == null || max === min) return choroColors[0];
  const ratio = Math.min((value - min) / (max - min), 1);
  const idx = Math.floor(ratio * (choroColors.length - 1));
  return choroColors[idx];
}

function getChoroMinMax(metric) {
  let min = Infinity,
    max = -Infinity;
  parcellesLayer.eachLayer((layer) => {
    const val = layer.feature.properties[metric];
    if (val != null) {
      if (val < min) min = val;
      if (val > max) max = val;
    }
  });
  return { min, max };
}

function applyChoroStyleToLayer(layer, metric) {
  const { min, max } = getChoroMinMax(metric);
  const val = layer.feature.properties[metric];
  layer.setStyle({
    fillColor: getChoroColor(val, min, max),
    fillOpacity: 0.6,
    color: "#922b21",
    weight: 1,
  });
}

function applyChoroplethe(metric) {
  if (!parcellesLayer) return;

  const legend = document.getElementById("choro-legend");

  if (metric === "none") {
    parcellesLayer.eachLayer((layer) => {
      if (layer !== selectedLayer) layer.setStyle(defaultStyle);
    });
    legend.classList.remove("visible");
    return;
  }

  const { min, max } = getChoroMinMax(metric);

  parcellesLayer.eachLayer((layer) => {
    if (layer === selectedLayer) return;
    const val = layer.feature.properties[metric];
    layer.setStyle({
      fillColor: getChoroColor(val, min, max),
      fillOpacity: 0.6,
      color: "#922b21",
      weight: 1,
    });
  });

  const formatVal =
    metric === "ratio_bati"
      ? (v) => (v * 100).toFixed(0) + "%"
      : (v) => Math.round(v).toLocaleString("fr-FR");

  document.getElementById("choro-legend-title").textContent =
    choroTitles[metric] || metric;
  document.getElementById("choro-min").textContent = formatVal(min);
  document.getElementById("choro-max").textContent = formatVal(max);
  legend.classList.add("visible");
}

// ========================================
//  RECHERCHE
// ========================================

async function searchByAddress() {
  const adresse = document.getElementById("input-adresse").value.trim();
  if (!adresse) return;
  showLoading();
  try {
    const data = await (
      await fetch(
        `${API_FUNC}.service_parcellaire_adresse/items?adresse=${encodeURIComponent(adresse)}`,
      )
    ).json();
    handleResult(data);
  } catch {
    showError("Erreur de connexion au service.");
  }
}

async function searchByCoords() {
  const x = document.getElementById("input-x").value;
  const y = document.getElementById("input-y").value;
  if (!x || !y) return;
  showLoading();
  try {
    const data = await (
      await fetch(
        `${API_FUNC}.service_parcellaire_xy/items?x=${x}&y=${y}&srid=2154`,
      )
    ).json();
    handleResult(data);
  } catch {
    showError("Erreur de connexion au service.");
  }
}

async function searchByLatLng(lng, lat) {
  showLoading();
  try {
    const data = await (
      await fetch(
        `${API_FUNC}.service_parcellaire_xy/items?x=${lng}&y=${lat}&srid=4326`,
      )
    ).json();
    handleResult(data);
  } catch {
    showError("Erreur de connexion au service.");
  }
}

// ========================================
//  AFFICHAGE DES RÉSULTATS
// ========================================

function handleResult(data) {
  if (!data.features?.length) return showError("Aucun résultat trouvé.");
  const f = data.features[0];
  if (f.properties.message && f.properties.message !== "OK")
    return showError(f.properties.message);
  displayResult(f);
}

function displayResult(feature) {
  const p = feature.properties;

  document.getElementById("res-adresse").textContent =
    p.adresse_trouvee || `Section ${p.section} | n°${p.numero}`;
  document.getElementById("res-id").textContent = p.id_parcelle;
  document.getElementById("res-surface").innerHTML =
    `${Math.round(p.surface_parcelle_m2).toLocaleString("fr-FR")} <span class="unit">m²</span>`;
  document.getElementById("res-batiments").textContent = p.nb_batiments;
  document.getElementById("res-surface-batie").innerHTML =
    `${Math.round(p.surface_batie_m2).toLocaleString("fr-FR")} <span class="unit">m²</span>`;
  document.getElementById("res-ratio").innerHTML =
    `${(p.ratio_bati * 100).toFixed(1)} <span class="unit">%</span>`;
  document.getElementById("res-pente").innerHTML = p.pente_moyenne_deg
    ? `${p.pente_moyenne_deg} <span class="unit">°</span>`
    : "|";
  document.getElementById("res-section").textContent =
    `${p.section} / ${p.numero}`;

  // DVF liste
  const dvf = document.getElementById("dvf-list");
  dvf.innerHTML = "";
  if (p.dvf_resume) {
    p.dvf_resume.split(" ; ").forEach((m) => {
      const parts = m.split(" | ");
      if (parts.length >= 4) {
        dvf.innerHTML += `
                    <div class="list-group-item d-flex justify-content-between align-items-center px-2 py-2">
                        <div><span class="fw-medium">${parts[0]}</span><br>
                        <small class="text-muted">${parts[1]} | ${parts[3]}</small></div>
                        <span class="dvf-price">${parts[2]}</span>
                    </div>`;
      }
    });
  } else {
    dvf.innerHTML =
      '<div class="text-center text-muted py-3 small fst-italic">Aucune transaction enregistrée</div>';
  }

  // Graphique DVF
  renderDvfChart(p.dvf_resume);

  // Carte : highlight parcelle
  if (selectedLayer && parcellesLayer) {
    const metric = document.getElementById("choro-select").value;
    if (metric !== "none") {
      applyChoroStyleToLayer(selectedLayer, metric);
    } else {
      selectedLayer.setStyle(defaultStyle);
    }
    selectedLayer = null;
  }

  if (parcellesLayer) {
    parcellesLayer.eachLayer((layer) => {
      if (
        (layer.feature.properties.id_parcelle ||
          layer.feature.properties.id) === p.id_parcelle
      ) {
        layer.setStyle(selectedStyle);
        selectedLayer = layer;
        map.fitBounds(layer.getBounds(), { padding: [100, 100], maxZoom: 18 });
      }
    });
  }
  if (!selectedLayer && feature.geometry) {
    selectedLayer = L.geoJSON(feature.geometry, { style: selectedStyle }).addTo(
      map,
    );
    map.fitBounds(selectedLayer.getBounds(), { padding: [100, 100] });
  }

  hideAll();
  document.getElementById("result").classList.remove("d-none");
}

// ========================================
//  GRAPHIQUE DVF
// ========================================

function renderDvfChart(dvfResume) {
  const container = document.getElementById("dvf-chart");
  container.innerHTML = "";
  if (!dvfResume) return;

  const mutations = dvfResume
    .split(" ; ")
    .map((m) => {
      const parts = m.split(" | ");
      if (parts.length < 4) return null;
      const price = parseFloat(parts[2].replace(/[^0-9.]/g, ""));
      return { date: parts[0], price: isNaN(price) ? 0 : price };
    })
    .filter(Boolean);

  if (mutations.length === 0) return;

  const maxPrice = Math.max(...mutations.map((m) => m.price));
  if (maxPrice === 0) return;

  container.innerHTML = '<div class="dvf-chart-title">Évolution des prix</div>';
  mutations.forEach((m) => {
    const pct = ((m.price / maxPrice) * 100).toFixed(0);
    const priceStr =
      m.price >= 1000000
        ? (m.price / 1000000).toFixed(1) + " M€"
        : Math.round(m.price).toLocaleString("fr-FR") + " €";
    container.innerHTML += `
            <div class="dvf-bar-row">
                <span class="dvf-bar-date">${m.date.substring(0, 7)}</span>
                <div class="dvf-bar-container">
                    <div class="dvf-bar" style="width:${pct}%"></div>
                </div>
                <span class="dvf-bar-label">${priceStr}</span>
            </div>`;
  });
}

// ========================================
//  DASHBOARD COMMUNAL
// ========================================

function updateDashboard() {
  if (!parcellesLayer) return;

  let totalParcelles = 0,
    totalSurface = 0,
    totalBatiments = 0;
  let totalRatio = 0,
    totalSurfaceBatie = 0;
  let hasStats = false;

  parcellesLayer.eachLayer((layer) => {
    const p = layer.feature.properties;
    totalParcelles++;
    if (p.surface_m2 != null) {
      hasStats = true;
      totalSurface += p.surface_m2;
      totalBatiments += p.nb_batiments || 0;
      totalRatio += p.ratio_bati || 0;
      totalSurfaceBatie += p.surface_batie_m2 || 0;
    }
  });

  if (!hasStats || totalParcelles === 0) return;

  document.getElementById("dash-parcelles").textContent =
    totalParcelles.toLocaleString("fr-FR");
  document.getElementById("dash-surface-moy").textContent =
    Math.round(totalSurface / totalParcelles).toLocaleString("fr-FR") + " m²";
  document.getElementById("dash-batiments").textContent =
    totalBatiments.toLocaleString("fr-FR");
  document.getElementById("dash-ratio-moy").textContent =
    ((totalRatio / totalParcelles) * 100).toFixed(1) + " %";
  document.getElementById("dash-surface-tot").textContent =
    (totalSurface / 10000).toFixed(1) + " ha";
  document.getElementById("dash-densite").textContent =
    Math.round(totalSurfaceBatie / totalParcelles).toLocaleString("fr-FR") +
    " m²";

  if (parcellesUseStats) {
    document.getElementById("dashboard").classList.remove("d-none");
  }
}

// ========================================
//  UI HELPERS
// ========================================

function showLoading() {
  hideAll();
  document.getElementById("loading").classList.add("visible");
}

function showError(msg) {
  hideAll();
  const e = document.getElementById("error");
  e.textContent = msg;
  e.classList.remove("d-none");
}

function hideAll() {
  document.getElementById("placeholder").style.display = "none";
  document.getElementById("dashboard").classList.add("d-none");
  document.getElementById("loading").classList.remove("visible");
  document.getElementById("error").classList.add("d-none");
  document.getElementById("result").classList.add("d-none");
}

function clearSelection() {
  if (selectedLayer && parcellesLayer) {
    const metric = document.getElementById("choro-select").value;
    if (metric !== "none") {
      applyChoroStyleToLayer(selectedLayer, metric);
    } else {
      selectedLayer.setStyle(defaultStyle);
    }
    selectedLayer = null;
  }
  document.getElementById("result").classList.add("d-none");
  document.getElementById("dvf-chart").innerHTML = "";
  document.getElementById("placeholder").style.display = "";
  document.getElementById("dashboard").classList.remove("d-none");
  document.getElementById("input-adresse").value = "";
  document.getElementById("input-x").value = "";
  document.getElementById("input-y").value = "";
  document.getElementById("choro-select").value = "none";
  applyChoroplethe("none");
  if (parcellesLayer)
    map.fitBounds(parcellesLayer.getBounds(), { padding: [20, 20] });
}

// ========================================
//  AUTOCOMPLÉTION ADRESSE
// ========================================

async function loadSuggestionsAdresse() {
  try {
    const data = await (
      await fetch(`${API_COLL}.adresse_ban/items.json?limit=2000`)
    ).json();
    const datalist = document.getElementById("suggestions-adresse");
    const seen = new Set();
    data.features.forEach((f) => {
      const p = f.properties;
      const adresse = `${p.numero} ${p.nom_voie}`;
      if (!seen.has(adresse)) {
        seen.add(adresse);
        const option = document.createElement("option");
        option.value = adresse;
        datalist.appendChild(option);
      }
    });
  } catch (err) {
    console.error("Erreur chargement suggestions:", err);
  }
}

// ========================================
//  INITIALISATION
// ========================================

document.getElementById("input-adresse").addEventListener("keydown", (e) => {
  if (e.key === "Enter") searchByAddress();
});

loadParcelles();
loadBatiments();
loadSuggestionsAdresse();

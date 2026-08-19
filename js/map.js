let loaderPromise = null;

export async function loadYandexMaps(apiKey) {
  if (window.ymaps) {
    return new Promise(resolve => window.ymaps.ready(resolve));
  }
  if (loaderPromise) return loaderPromise;

  loaderPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `https://api-maps.yandex.ru/2.1/?apikey=${encodeURIComponent(apiKey)}&lang=ru_RU`;
    script.async = true;
    script.onload = () => {
      if (!window.ymaps) {
        reject(new Error("Yandex Maps API загрузился некорректно."));
        return;
      }
      window.ymaps.ready(resolve);
    };
    script.onerror = () => reject(new Error("Не удалось загрузить Yandex Maps API."));
    document.head.appendChild(script);
  });

  return loaderPromise;
}

function preset(status) {
  const s = String(status || "").toUpperCase();
  if (s === "НЕ ДОЗВОНИЛСЯ") return "islands#orangeDotIcon";
  if (s === "ПЕРЕЗВОНИТЬ") return "islands#yellowDotIcon";
  if (s === "ПЕРСПЕКТИВНЫЙ") return "islands#greenDotIcon";
  if (s === "В РАБОТЕ") return "islands#violetDotIcon";
  if (s === "НЕИНТЕРЕСЕН" || s === "АРХИВ") return "islands#grayDotIcon";
  return "islands#blueDotIcon";
}

export class CRMMap {
  constructor({ containerId, center, zoom, onSelect }) {
    this.containerId = containerId;
    this.center = center;
    this.zoom = zoom;
    this.onSelect = onSelect;
    this.map = null;
    this.clusterer = null;
    this.hasFit = false;
  }

  init() {
    if (this.map) return;
    const node = document.getElementById(this.containerId);
    node.innerHTML = "";

    this.map = new window.ymaps.Map(this.containerId, {
      center: this.center,
      zoom: this.zoom,
      controls: ["zoomControl", "geolocationControl", "fullscreenControl"]
    }, { suppressMapOpenBlock: true });

    this.clusterer = new window.ymaps.Clusterer({
      preset: "islands#invertedBlueClusterIcons",
      groupByCoordinates: false,
      clusterDisableClickZoom: false,
      clusterOpenBalloonOnClick: false,
      gridSize: 64
    });

    this.map.geoObjects.add(this.clusterer);
  }

  render(items, { fit = false } = {}) {
    if (!this.map || !this.clusterer) return;
    this.clusterer.removeAll();

    const placemarks = items
      .filter(item => Number.isFinite(item.lat) && Number.isFinite(item.lng))
      .map(item => {
        const mark = new window.ymaps.Placemark(
          [item.lat, item.lng],
          { hintContent: item.address || "Объект" },
          { preset: preset(item.status) }
        );
        mark.events.add("click", () => this.onSelect(item));
        return mark;
      });

    this.clusterer.add(placemarks);

    if (placemarks.length && (fit || !this.hasFit)) {
      const bounds = this.clusterer.getBounds();
      if (bounds) this.map.setBounds(bounds, { checkZoomRange: true, zoomMargin: 60, duration: 250 });
      this.hasFit = true;
    }
  }

  focus(item) {
    if (!this.map || !Number.isFinite(item.lat) || !Number.isFinite(item.lng)) return;
    this.map.setCenter([item.lat, item.lng], Math.max(15, this.map.getZoom()), { duration: 250 });
  }

  fitViewport() {
    if (this.map?.container) this.map.container.fitToViewport();
  }

  async geocode(address) {
    const result = await window.ymaps.geocode(address, { results: 1 });
    const obj = result.geoObjects.get(0);
    if (!obj) return null;
    const coords = obj.geometry.getCoordinates();
    if (!Array.isArray(coords) || coords.length < 2) return null;
    return { lat: Number(coords[0]), lng: Number(coords[1]), normalizedAddress: obj.getAddressLine?.() || address };
  }
}

const CACHE_NAME = "algoculture-v1";
const SYNC_TAG   = "sync-releves";

// Fichiers à mettre en cache pour le mode hors-ligne
const ASSETS = [
  "./index.html",
  "./style.css",
  "./manifest.json"
];

// ── Installation : mise en cache des assets ──────────────────────────────────
self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

// ── Activation : nettoyage des anciens caches ────────────────────────────────
self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ── Fetch : répondre depuis le cache si hors-ligne ───────────────────────────
self.addEventListener("fetch", event => {
  // Ne pas intercepter les requêtes vers Google Sheets
  if (event.request.url.includes("script.google.com")) return;

  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        // Mettre en cache les nouvelles ressources
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        return response;
      }).catch(() => caches.match("./index.html"));
    })
  );
});

// ── Background Sync : envoi automatique quand le réseau revient ──────────────
self.addEventListener("sync", event => {
  if (event.tag === SYNC_TAG) {
    event.waitUntil(syncReleves());
  }
});

async function syncReleves() {
  // Lire la file d'attente depuis IndexedDB
  const queue = await getQueue();
  if (!queue || queue.length === 0) return;

  try {
    await fetch("https://script.google.com/macros/s/AKfycbylQrJZXYcjA-uOBfTVJx7j_mj1u9a4mVHCnrNzomknbQHYggLomadrr9ovb1HmrUqZ/exec", {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ batch: queue })
    });
    // Succès : vider la file et notifier l'app
    await clearQueue();
    self.clients.matchAll().then(clients =>
      clients.forEach(c => c.postMessage({ type: "SYNC_SUCCESS", count: queue.length }))
    );
  } catch (err) {
    // Échec : on réessaiera au prochain sync
    throw err;
  }
}

// ── IndexedDB helpers ─────────────────────────────────────────────────────────
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("algoculture", 1);
    req.onupgradeneeded = e => {
      e.target.result.createObjectStore("queue", { keyPath: "id" });
    };
    req.onsuccess = e => resolve(e.target.result);
    req.onerror   = e => reject(e.target.error);
  });
}

async function getQueue() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction("queue", "readonly");
    const req = tx.objectStore("queue").getAll();
    req.onsuccess = e => resolve(e.target.result);
    req.onerror   = e => reject(e.target.error);
  });
}

async function clearQueue() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction("queue", "readwrite");
    const req = tx.objectStore("queue").clear();
    req.onsuccess = () => resolve();
    req.onerror   = e => reject(e.target.error);
  });
}

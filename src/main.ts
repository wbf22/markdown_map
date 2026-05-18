import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { marked } from "marked";

interface DirEntry {
  path: string;
  name: string;
  entry_type: string;
  modified: number;
}

interface Positions {
  [key: string]: { x: number; y: number };
}

interface CardData {
  path: string;
  name: string;
  type: string;
  el: HTMLElement;
  x: number;
  y: number;
}

let panX = 0;
let panY = 0;
let zoom = 1;
let isPanning = false;
let panStartX = 0;
let panStartY = 0;
let panStartPanX = 0;
let panStartPanY = 0;
let dragCard: CardData | null = null;
let dragStartX = 0;
let dragStartY = 0;
let dragCardStartX = 0;
let dragCardStartY = 0;
let editorOpen = false;
let currentEditFile = "";
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let cards: CardData[] = [];
let resizeCard: CardData | null = null;
let resizeStartW = 0;
let resizeStartH = 0;
let resizeStartX = 0;
let resizeStartY = 0;
let dragThreshold = 6;
let dragDistance = 0;

const canvas = document.getElementById("canvas")!;
const viewport = document.getElementById("viewport")!;
const container = document.getElementById("canvas-container")!;
const editorPanel = document.getElementById("editor-panel")!;
const editorTextarea = document.getElementById("editor-textarea") as HTMLTextAreaElement;
const editorFilename = document.getElementById("editor-filename")!;
const zoomLabel = document.getElementById("zoom-label")!;
const dirPath = document.getElementById("dir-path")!;
const modalOverlay = document.getElementById("modal-overlay")!;
const modalInput = document.getElementById("modal-input") as HTMLInputElement;
const toast = document.getElementById("toast")!;
let pendingCreate = false;
let loadingDir = false;

async function loadDirectory() {
  if (loadingDir) return;
  loadingDir = true;
  try {
    const entries: DirEntry[] = await invoke("read_directory");
    const positions: Positions = await invoke("read_positions");

    canvas.innerHTML = "";
    cards = [];

    const mdEntries = entries.filter(e => e.entry_type === "md");
    const imgEntries = entries.filter(e => e.entry_type === "image");

    let col = 0;
    let row = 0;
    const gapX = 30;
    const gapY = 30;
    const defaultW = 300;

    for (const entry of mdEntries) {
      const pos = positions[entry.name];
      const x = pos ? pos.x : col * (defaultW + gapX);
      const y = pos ? pos.y : row * 200;
      await createMdCard(entry, x, y);
      col++;
    }

    for (const entry of imgEntries) {
      const pos = positions[entry.name];
      const x = pos ? pos.x : col * (defaultW + gapX);
      const y = pos ? pos.y : row * 200;
      await createImageCard(entry, x, y);
      col++;
    }
  } finally {
    loadingDir = false;
  }
}

function showToast(msg: string) {
  toast.textContent = msg;
  toast.classList.remove("hidden");
  setTimeout(() => toast.classList.add("hidden"), 3000);
}

function showModal() {
  modalInput.value = "untitled";
  modalOverlay.classList.remove("hidden");
  setTimeout(() => modalInput.focus(), 100);
  modalInput.select();
}

function hideModal() {
  modalOverlay.classList.add("hidden");
  pendingCreate = false;
}

function updateViewport() {
  viewport.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
  zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
}

async function createMdCard(entry: DirEntry, x: number, y: number) {
  const content = await invoke<string>("read_file", { path: entry.path });
  const html = marked.parse(content, { breaks: true }) as string;

  const card = document.createElement("div");
  card.className = "card";
  card.style.left = x + "px";
  card.style.top = y + "px";
  card.style.width = "300px";

  const preview = document.createElement("div");
  preview.className = "card-preview";
  preview.innerHTML = html;

  card.appendChild(preview);

  card.addEventListener("pointerdown", (e) => {
    e.stopPropagation();
    dragDistance = 0;
    startDrag(card, entry.name, e);
  });

  canvas.appendChild(card);

  const cd: CardData = { path: entry.path, name: entry.name, type: "md", el: card, x, y };
  cards.push(cd);

  const mdContent = content;
  card.setAttribute("data-md-content", mdContent);
}

async function createImageCard(entry: DirEntry, x: number, y: number) {
  const dataUrl = await invoke<string>("get_image_data_url", { path: entry.path });

  const card = document.createElement("div");
  card.className = "image-card";
  card.style.left = x + "px";
  card.style.top = y + "px";

  const header = document.createElement("div");
  header.className = "card-header";
  header.innerHTML = `<span class="card-title">🖼 ${escapeHtml(entry.name)}</span>`;

  const img = document.createElement("img");
  img.src = dataUrl;
  img.draggable = false;

  card.appendChild(header);
  card.appendChild(img);

  header.addEventListener("pointerdown", (e) => {
    e.stopPropagation();
    startDrag(card, entry.name, e);
  });

  canvas.appendChild(card);

  const cd: CardData = { path: entry.path, name: entry.name, type: "image", el: card, x, y };
  cards.push(cd);
}

function startDrag(card: HTMLElement, name: string, e: PointerEvent) {
  dragCard = cards.find(c => c.name === name) || null;
  if (!dragCard) return;
  dragStartX = e.clientX;
  dragStartY = e.clientY;
  dragCardStartX = dragCard.x;
  dragCardStartY = dragCard.y;
  card.classList.add("dragging");
  card.setPointerCapture(e.pointerId);
}

function startResize(card: HTMLElement, e: PointerEvent) {
  resizeCard = cards.find(c => c.el === card) || null;
  if (!resizeCard) return;
  resizeStartW = card.offsetWidth;
  resizeStartH = card.offsetHeight;
  resizeStartX = e.clientX;
  resizeStartY = e.clientY;
  card.setPointerCapture(e.pointerId);
}

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

async function openEditor(path: string, name: string) {
  if (editorOpen && currentEditFile === path) return;

  const content = await invoke<string>("read_file", { path });
  currentEditFile = path;
  editorFilename.textContent = name;
  editorTextarea.value = content;
  editorPanel.classList.remove("hidden");
  editorOpen = true;
  editorTextarea.focus();
}

function closeEditor() {
  editorPanel.classList.add("hidden");
  editorOpen = false;
  currentEditFile = "";
  editorTextarea.value = "";
}

async function saveCurrentFile() {
  if (!currentEditFile) return;
  try {
    await invoke("write_file", { path: currentEditFile, content: editorTextarea.value });
    const card = cards.find(c => c.path === currentEditFile);
    if (card && card.type === "md") {
      const preview = card.el.querySelector(".card-preview")!;
      preview.innerHTML = marked.parse(editorTextarea.value, { breaks: true }) as string;
      card.el.setAttribute("data-md-content", editorTextarea.value);
    }
  } catch (e) {
    console.error("Save failed:", e);
  }
}

async function savePositions() {
  const positions: Positions = {};
  for (const card of cards) {
    const rect = card.el.getBoundingClientRect();
    const parentRect = canvas.getBoundingClientRect();
    positions[card.name] = {
      x: card.x,
      y: card.y,
    };
  }
  try {
    await invoke("write_positions", { positions });
  } catch (e) {
    console.error("Failed to save positions:", e);
  }
}

container.addEventListener("pointerdown", (e) => {
  if (e.target === container || e.target === canvas || e.target === viewport) {
    isPanning = true;
    panStartX = e.clientX;
    panStartY = e.clientY;
    panStartPanX = panX;
    panStartPanY = panY;
    container.classList.add("panning");
    container.setPointerCapture(e.pointerId);
  }
});

document.addEventListener("pointermove", (e) => {
  if (isPanning) {
    const dx = e.clientX - panStartX;
    const dy = e.clientY - panStartY;
    panX = panStartPanX + dx;
    panY = panStartPanY + dy;
    updateViewport();
  }
  if (dragCard) {
    const dx = (e.clientX - dragStartX) / zoom;
    const dy = (e.clientY - dragStartY) / zoom;
    dragDistance += Math.abs(e.movementX) + Math.abs(e.movementY);
    dragCard.x = dragCardStartX + dx;
    dragCard.y = dragCardStartY + dy;
    dragCard.el.style.left = dragCard.x + "px";
    dragCard.el.style.top = dragCard.y + "px";
  }
  if (resizeCard) {
    const dx = (e.clientX - resizeStartX) / zoom;
    const dy = (e.clientY - resizeStartY) / zoom;
    const newW = Math.max(150, resizeStartW + dx);
    const newH = Math.max(60, resizeStartH + dy);
    resizeCard.el.style.width = newW + "px";
    resizeCard.el.style.height = newH + "px";
  }
});

document.addEventListener("pointerup", () => {
  if (isPanning) {
    isPanning = false;
    container.classList.remove("panning");
  }
  if (dragCard) {
    dragCard.el.classList.remove("dragging");
    if (dragDistance > dragThreshold) {
      savePositions();
    } else if (dragCard.type === "md") {
      openEditor(dragCard.path, dragCard.name);
    }
    dragCard = null;
  }
  if (resizeCard) {
    resizeCard = null;
    savePositions();
  }
});

container.addEventListener("wheel", (e) => {
  if (e.ctrlKey || e.metaKey) {
    e.preventDefault();
    const delta = -e.deltaY * 0.001;
    const newZoom = Math.max(0.1, Math.min(5, zoom + delta * zoom));
    const rect = container.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const oldZoom = zoom;
    zoom = newZoom;
    panX = mx - (mx - panX) * (zoom / oldZoom);
    panY = my - (my - panY) * (zoom / oldZoom);
    updateViewport();
  }
}, { passive: false });

document.getElementById("btn-zoom-in")!.addEventListener("click", () => {
  const oldZoom = zoom;
  zoom = Math.min(5, zoom * 1.25);
  panX = container.clientWidth / 2 - (container.clientWidth / 2 - panX) * (zoom / oldZoom);
  panY = container.clientHeight / 2 - (container.clientHeight / 2 - panY) * (zoom / oldZoom);
  updateViewport();
});

document.getElementById("btn-zoom-out")!.addEventListener("click", () => {
  const oldZoom = zoom;
  zoom = Math.max(0.1, zoom / 1.25);
  panX = container.clientWidth / 2 - (container.clientWidth / 2 - panX) * (zoom / oldZoom);
  panY = container.clientHeight / 2 - (container.clientHeight / 2 - panY) * (zoom / oldZoom);
  updateViewport();
});

document.getElementById("btn-reset-view")!.addEventListener("click", () => {
  zoom = 1;
  panX = 0;
  panY = 0;
  updateViewport();
});

document.getElementById("btn-new-file")!.addEventListener("click", showModal);

document.getElementById("modal-confirm")!.addEventListener("click", async () => {
  if (pendingCreate) return;
  pendingCreate = true;

  const name = modalInput.value.trim();
  if (!name) {
    showToast("Please enter a file name");
    pendingCreate = false;
    return;
  }

  const filename = name.endsWith(".md") ? name : name + ".md";
  let path: string;
  try {
    path = await invoke<string>("get_current_directory");
  } catch (e) {
    showToast("Failed to get directory path");
    pendingCreate = false;
    return;
  }

  const fullPath = path + "/" + filename;
  const safeName = name.replace(/\.md$/i, "");
  const template = `# ${safeName}\n\nStart writing...\n`;

  try {
    await invoke("write_file", { path: fullPath, content: template });
    hideModal();
    await loadDirectory();
    await openEditor(fullPath, filename);
    showToast(`Created ${filename}`);
  } catch (e) {
    showToast("Failed to create file: " + e);
  }
  pendingCreate = false;
});

document.getElementById("modal-cancel")!.addEventListener("click", hideModal);
document.getElementById("modal-close")!.addEventListener("click", hideModal);
modalOverlay.addEventListener("click", (e) => {
  if (e.target === modalOverlay) hideModal();
});
modalInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") document.getElementById("modal-confirm")!.click();
  if (e.key === "Escape") hideModal();
});

document.getElementById("editor-close")!.addEventListener("click", closeEditor);

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !modalOverlay.classList.contains("hidden")) {
    hideModal();
    return;
  }
  if (e.key === "Escape" && editorOpen) {
    closeEditor();
  }
  if ((e.metaKey || e.ctrlKey) && e.key === "s" && editorOpen) {
    e.preventDefault();
    saveCurrentFile();
  }
});

editorTextarea.addEventListener("input", () => {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveCurrentFile(), 500);
});

async function pickFolder() {
  try {
    const path = await invoke<string>("pick_directory");
    dirPath.textContent = path;
    await loadDirectory();
    updateViewport();
    showToast("Opened: " + path);
  } catch (e) {
    // cancelled
  }
}

async function init() {
  const path = await invoke<string>("get_current_directory");
  dirPath.textContent = path;

  dirPath.style.cursor = "pointer";
  dirPath.style.textDecoration = "underline dotted";
  dirPath.addEventListener("click", pickFolder);

  await loadDirectory();
  updateViewport();

  if (cards.length === 0) {
    showToast("No files found. Select a folder to open.");
    pickFolder();
  }

  listen("files-changed", () => {
    loadDirectory();
  });
}

init();
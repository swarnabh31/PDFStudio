# PDF Studio

**Edit, sign, split, merge, watermark, protect, and convert PDFs — entirely in your browser.**

PDF Studio is a fast, modern, web-based PDF toolkit. Open a document and get to work: fix text, add signatures, rearrange pages, stamp watermarks, lock it with a password, or convert it to and from Word, images, Markdown, and plain text.

> 🔒 **Zero Server Upload** — every operation runs on your machine, in the tab you're looking at. Your files never leave your computer.

---

## 1. What is this application?

PDF Studio is a single-page web application built with **TypeScript + Vite** that bundles a complete PDF workflow into one screen:

- A document reader/editor powered by **PDF.js**
- A full PDF manipulation engine using **pdf-lib** and **qpdf (via WebAssembly)**
- Seven built-in converters for PDF, Word, images, Markdown, and text
- No accounts, no installs, no server — open the page, drop in a file, download the result

It's designed for everyday document tasks: cleaning up a scanned report before signing, merging a set of invoices, protecting a contract before sending, or turning images and Markdown notes into shareable PDFs.

---

## 2. Advantages of PDF Studio

| Advantage | Why it matters |
|---|---|
| **Total privacy** | 100% client-side processing. Sensitive contracts, invoices, and ID documents are never uploaded to any server. |
| **No installation** | Runs in any modern browser — desktop or mobile. Open it, use it, close it. |
| **One tool, every task** | Editing, signing, page management, watermarks, security, merging, splitting, and converting live on a single screen — no tool-hopping. |
| **Instant feedback** | Watermark previews update live, page reorders apply instantly, and every change is **undoable** without saving. |
| **Free & open** | No paywalls, upload limits, page caps, or watermarks added *to* your PDFs. |
| **Works offline** | Once loaded, the app needs no network connection (fonts optional). |
| **Cross-platform** | Windows, macOS, Linux, Android, and iOS — everything in stock browser APIs, WebAssembly, and Canvas. |

---

## 3. Features

### ✍️ Edit text
Open a PDF and edit its text directly in an on-screen editor, then save the updated document.

### 🖋️ Sign & images
- **Draw a signature** with mouse, touch, or pressure-sensitive pen (black or blue)
- **Add images** anywhere on a page
- **Drag to move** items — even across pages
- **Stretch a side**, or **resize proportionally** from a corner
- Apply and download in one click

### 📄 Pages
- Click a page to select it, **Select all** in one go
- **Rotate left / right**
- **Delete** unwanted pages
- **Drag to reorder** pages visually
- Changes apply instantly; **Undo** reverts any of it

### 💧 Watermark
- Text **or image** watermarks
- **Single (centred)** or **tiled** layout
- Control size, angle, colour, and opacity
- Target specific **pages** (`all`, or ranges like `1-3, 5`)
- **Live preview** before you commit
- Replace an earlier watermark or **remove** watermarks (yours or those tagged by other tools)

### 🔐 Password
- **Encrypt with AES-256** and download a protected copy
- Optional **restrictions**: allow/disallow printing, copying, editing — enforced by an owner password
- **Remove a password**: open a protected PDF, enter its password, keep working on the unprotected original, and restore it anytime with Undo

### 🔗 Merge
Combine multiple PDFs into a single file, in the order you list them. You can add the currently open document with one click.

### ✂️ Split
- Extract selected pages or custom ranges (e.g. `1-3, 5`) into a clean, standalone PDF
- **One file per range** (downloads as a `.zip`)
- One file per page, or split every N pages

### 🔄 Convert
| Converter | Direction | Notes |
|---|---|---|
| PDF → Word | to `.docx` | Editable Word document; bold runs and headings preserved where possible |
| Word → PDF | from `.docx` | Headings, bold, and inline images carried over |
| Image → PDF | PNG · JPG · WebP · GIF | One image per page, sized to the image or A4 |
| Markdown → PDF | to PDF | Headings, bold, lists, code blocks rendered cleanly |
| PDF → Markdown | to `.md` | Extract text with headings and paragraphs |
| TXT → PDF | to PDF | Tidy, word-wrapped, paginated |
| PDF → TXT | to `.txt` | Readable plain text, page by page |

### ⌨️ Quality of life
- **Undo / Redo** (`Ctrl+Z` / `Ctrl+Shift+Z`) for every document change
- **Open with `Ctrl+O`**, drag-and-drop file picking throughout
- Status bar shows the open document and a one-click **Download PDF**
- Clean, dark, keyboard-friendly interface built for focus

---

## 4. How to use it

**Requirements:** a modern web browser (Chrome, Edge, Firefox, or Safari). Nothing to install.

### Quick start
1. **Open the app** — run `npm run dev` locally, or serve the `dist/` build with any static web server (`npm run preview` works out of the box).
2. **Open a PDF** — click **Open PDF** or press `Ctrl+O`, and pick a file.
3. **Pick a tool from the top nav** — Edit text, Sign & images, Pages, Watermark, Password, Merge, Split, or Convert.
4. **Make your changes** — each panel has its own controls; previews update live where supported.
5. **Download** — click **Download PDF** (or the converter's action button) to save the result.
6. **Changed your mind?** `Ctrl+Z` / `Ctrl+Shift+Z` undoes and redoes document changes at any point.

### Per-tool notes
- **Edit text** — open the PDF, select the **Edit text** tab, edit directly, then download.
- **Sign & images** — add a signature by hand (mouse/touch/pen) or add an image, drag it into position, resize from edges/corners, then **Apply & download**.
- **Pages** — click pages to select (or Select all), rotate/delete, drag to reorder; Undo reverts instantly.
- **Watermark** — set text/image, layout, size, angle, colour, opacity, and pages; preview on the right; then **Apply watermark** or **Remove watermarks**.
- **Password** — enter a password (plus optional restrictions) and **Encrypt & download**; or enter the existing password and **Remove password**.
- **Merge / Split / Convert** — follow the panel prompts; converters auto-download the resulting file.

### Running the project locally
```bash
npm install
npm run dev       # start the dev server
npm run build     # type-check + production build into dist/
npm run preview   # serve the production build locally
```

---

## Tech stack

- **TypeScript 5** + **Vite 8** build pipeline
- **PDF.js** — PDF rendering and reading
- **pdf-lib** — PDF creation and manipulation
- **qpdf (WebAssembly)** — encryption/security operations in the browser
- **fflate** — fast ZIP creation for multi-file downloads
- No backend, no database, no build-time API keys

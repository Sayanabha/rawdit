# Contributing to rawdit 

First off - thanks for being here. Open source only works because people like you show up.

This document covers how to contribute, what we need help with, and how to not accidentally break everything (we do enough of that ourselves).

---

## Before You Start

rawdit is a client-side RAW image editor built with React, WebGL2, and a healthy amount of stubbornness. Before contributing, spend 10 minutes actually using the app and reading through the [README](./README.md). Understanding what the project *does* makes contributing a lot less confusing.

---

## Ways to Contribute

You don't have to write code to contribute. Genuinely.

**If you write code:**
- Fix bugs (see Issues tab - there are definitely some)
- Implement features from the roadmap
- Improve the RAW decoding pipeline (this is where the real fun is)
- Write tests (yes, we know, we know)

**If you don't write code:**
- Report bugs with a clear description and your camera model
- Test with RAW files from different cameras and tell us what breaks
- Improve documentation
- Suggest features that aren't already on the roadmap

---

## Getting Started

### 1. Fork the repo

Click the **Fork** button on GitHub. This creates your own copy.

### 2. Clone your fork

```bash
git clone https://github.com/Sayanabha/rawdit.git
cd rawdit
```

### 3. Create a branch

Name your branch something that explains what you're doing:

```bash
git checkout -b fix/nef-decode-crash
# or
git checkout -b feature/histogram-panel
# or
git checkout -b docs/improve-shader-comments
```

Don't work directly on `main`. We will cry.

### 4. Install dependencies

```bash
npm install
```

### 5. Run the dev server

```bash
npm run dev
```

### 6. Make your changes

Write code. Test it. Make sure it actually works. Drop a few different RAW files on it. Check the browser console for errors.

### 7. Commit with a clear message

```bash
git add .
git commit -m "fix: handle missing AsShotNeutral tag in Fuji RAF files"
```

We loosely follow [Conventional Commits](https://www.conventionalcommits.org/):
- `fix:` for bug fixes
- `feat:` for new features
- `docs:` for documentation changes
- `refactor:` for code changes that don't add features or fix bugs
- `perf:` for performance improvements

### 8. Push and open a Pull Request

```bash
git push origin your-branch-name
```

Then go to GitHub and open a PR against `main`. Write a description that explains *what* you changed and *why*. Screenshots or console logs are very welcome.

---

## What Makes a Good PR

- **Focused** - one thing per PR. A PR that fixes a bug AND adds a feature AND refactors two files is hard to review.
- **Tested** - you've actually dropped RAW files on it and verified it works
- **Described** - the PR description explains what changed and why
- **Clean** - no commented-out code, no `console.log("here2")` left over from debugging

---

## Areas That Need the Most Help

### RAW Decode Pipeline
The current demosaicing is bilinear - it works but it's not great for high-frequency detail. A proper AHD (Adaptive Homogeneity-Directed) demosaic would be a huge improvement. Lives in `src/workers/raw-decoder.worker.ts`.

### Camera Compatibility
We've tested primarily with DNG files. NEF, CR2, ARW, RAF files may behave differently. If you have cameras from different manufacturers, testing and reporting (or fixing) issues is incredibly valuable.

### GLSL Shaders
The fragment shader in `src/engine/shaders/fragment.glsl.ts` handles all the editing math. There's room to improve the tone curve, highlights/shadows recovery, and color science. If you know colour grading or GLSL, this is where to dig.

### AI Masking (Active Branch: `AI-Masking-S`)
We're working on integrating SAM (Segment Anything Model) via ONNX Runtime Web. If you've worked with `onnxruntime-web` or browser-based ML inference, jump in.

---

## Code Style

- TypeScript everywhere. No plain JS files.
- Keep components focused - if a file is getting long, split it up
- CSS variables for all colours (defined in `index.css`)
- No external UI libraries beyond what's already installed
- Keep shader code commented - GLSL is not self-documenting

---

## Bug Reports

When filing a bug, please include:

1. **Your browser and version** (e.g. Chrome 121)
2. **Your camera make and model** (e.g. Sony A7IV)
3. **The RAW format** (e.g. `.ARW`)
4. **What you expected to happen**
5. **What actually happened**
6. **Console output** - open DevTools (F12), paste anything in red or starting with `[Worker]`

You don't need to share the actual RAW file (they're huge and personal) but knowing the camera model helps a lot.

---

## Contributors

| Name | Contribution |
|------|-------------|
| *Your name here* | *Be the first* |

---

*rawdit is built in public. Every contribution, big or small, moves it forward.*
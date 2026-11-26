# WebScout

WebScout answers a question from web pages and shows its proof.

Every answer is copied word for word from a real page. You can see the source, the evidence, and each step the engine took. If the pages do not hold a good answer, WebScout says so instead of guessing.

## How it works

1. **Understand** the question.
2. **Discover** pages (Wikimedia search, or a start URL you give).
3. **Fetch** the pages.
4. **Extract** possible answers from tables, structured data, and text.
5. **Select** the best one.
6. **Verify** it against the page text. Weak answers are rejected.
7. **Format** the answer with its evidence, or abstain.

No AI model, API key, or paid service is needed.

## Run it

```bash
npm install
npm run dev      # http://localhost:3000
npm test         # run the tests
npm run build    # production build
```

## Project layout

| Folder | Purpose |
|---|---|
| `engine/` | The answer pipeline (TypeScript, no network code of its own) |
| `src/` | The React web app |
| `engine/__tests__/` | Tests and sample pages |

## Try these

- Demo mode (works offline): "What is the peak throughput in Chile?"
- Live mode: "What is the capital of Chile?"

## Built with

React, Vite, Tailwind CSS, parse5, Vitest.

## Deploy on an AMD GPU (ROCm)

See [deploy/AMD_GPU.md](deploy/AMD_GPU.md). The GPU part is optional. Without it, WebScout runs on CPU.

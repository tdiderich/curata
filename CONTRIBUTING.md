# Contributing to curata

Thanks for your interest in contributing. Curata is a small project and we welcome issues, feedback, and pull requests.

---

## How to Contribute

**Found a bug or have a feature request?**
Open an issue at [github.com/tdiderich/curata/issues](https://github.com/tdiderich/curata/issues). Include steps to reproduce for bugs, or a clear description of the use case for feature requests.

**Want to submit a PR?**
1. Fork the repo and create a branch from `main`.
2. Make your changes and verify locally (see below).
3. Open a pull request with a short description of what you changed and why.

For larger changes, open an issue first to discuss before writing code — saves everyone time.

---

## Development Setup

```bash
git clone https://github.com/tdiderich/curata.git
cd curata
cp .env.example .env
pnpm install
docker compose up
```

The app runs at `http://localhost:3000`. The database and migrations are handled automatically on startup.

To run the Next.js dev server with hot reload:

```bash
pnpm dev
```

---

## Code Style

The project uses **ESLint** and **Prettier** (via `eslint-config-next`). Your editor should pick up the config automatically. To check manually:

```bash
pnpm lint
```

Please don't submit PRs that introduce lint errors.

---

## Testing

```bash
pnpm test
```

Tests live in `/tests` and use [Vitest](https://vitest.dev). Add or update tests for any logic you change.

---

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](./LICENSE).

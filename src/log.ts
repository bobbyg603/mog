const RED = "\x1b[0;31m";
const GREEN = "\x1b[0;32m";
const YELLOW = "\x1b[1;33m";
const CYAN = "\x1b[0;36m";
const NC = "\x1b[0m";

export const log = {
  info: (msg: string) => console.log(`${CYAN}[mog]${NC} ${msg}`),
  ok: (msg: string) => console.log(`${GREEN}[mog]${NC} ${msg}`),
  warn: (msg: string) => console.log(`${YELLOW}[mog]${NC} ${msg}`),
  err: (msg: string) => console.error(`${RED}[mog]${NC} ${msg}`),
  die: (msg: string) => {
    log.err(msg);
    process.exit(1);
  },
  tool: (name: string, detail: string) => console.log(`${CYAN}[${name}]${NC} ${detail}`),
  done: (msg: string) => console.log(`\n${GREEN}[done]${NC} ${msg}`),
};

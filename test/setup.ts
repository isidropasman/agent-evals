import path from "node:path";

process.env.GAUNTLET_DATA_DIR = path.join(process.cwd(), ".context", "test-data");

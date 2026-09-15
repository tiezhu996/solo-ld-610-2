import { config } from "../config/env";
import { getDb } from "./sqlite";
import { runSeed } from "./seedData";

getDb(config.dbPath);
const { seeded } = runSeed();
console.log(seeded ? "seed inserted" : "seed skipped (database not empty)");

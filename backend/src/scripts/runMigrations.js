// src/scripts/runMigrations.js
import { AppDataSource } from "../database/newDbSetup.js";
import { up } from "../database/migrations/createSyncedRecoveryData.js";

async function runMigrations() {
  try {
    console.log("Running migrations...");
    
    // Get query runner
    const queryRunner = AppDataSource.createQueryRunner();
    
    // Connect to database
    await queryRunner.connect();
    
    // Run migrations
    await up(queryRunner);
    
    console.log("Migrations completed successfully");
    
    // Release query runner
    await queryRunner.release();
    
    process.exit(0);
  } catch (error) {
    console.error("Migration failed:", error);
    process.exit(1);
  }
}

runMigrations();
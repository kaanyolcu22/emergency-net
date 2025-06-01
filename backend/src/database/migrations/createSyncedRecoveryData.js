
export async function up(queryRunner) {
    console.log("Running createSyncedRecoveryData migration...");
    
    const hasRecoverySignatureColumn = await queryRunner.hasColumn('user', 'recoverySignature');
    const hasRecoverySourceColumn = await queryRunner.hasColumn('user', 'recoverySource');
    
    if (!hasRecoverySignatureColumn) {
      await queryRunner.query(`ALTER TABLE "user" ADD COLUMN "recoverySignature" text`);
      console.log("Added recoverySignature column to User table");
    }
    
    if (!hasRecoverySourceColumn) {
      await queryRunner.query(`ALTER TABLE "user" ADD COLUMN "recoverySource" varchar`);
      console.log("Added recoverySource column to User table");
    }
    
    console.log("Migration completed successfully");
  }
  
  export async function down(queryRunner) {
    await queryRunner.query(`ALTER TABLE "user" DROP COLUMN "recoverySignature"`);
    await queryRunner.query(`ALTER TABLE "user" DROP COLUMN "recoverySource"`);
    console.log("Reverted createSyncedRecoveryData migration");
  }
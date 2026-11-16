'use strict';
const { addDays } = require('../library');

// Nettoyage planifié (tous les jours à 03:00) : supprime les exports PDF expirés et les CSV
// d'import anciens, en base ET dans le stockage objet. On ne paie pas pour stocker l'inutile (FinOps).
function cleanupJob({ db, storage, config, logger }) {
  return async () => {
    const bucket = config.storage.attachmentsBucket;
    const exportsOld = await db.query('SELECT id, object_key FROM exports WHERE created_at < $1', [
      addDays(-config.exportRetentionDays),
    ]);
    for (const e of exportsOld.rows) {
      if (e.object_key) await storage.remove(bucket, e.object_key);
      await db.query('DELETE FROM exports WHERE id = $1', [e.id]);
    }
    const importsOld = await db.query("SELECT id, object_key FROM imports WHERE status <> 'pending' AND created_at < $1", [
      addDays(-config.importRetentionDays),
    ]);
    for (const i of importsOld.rows) {
      await storage.remove(bucket, i.object_key);
      await db.query('DELETE FROM imports WHERE id = $1', [i.id]);
    }
    const summary = { exports: exportsOld.rows.length, imports: importsOld.rows.length };
    logger.info(summary, 'nettoyage terminé');
    return summary;
  };
}

module.exports = { cleanupJob };

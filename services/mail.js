function createMailService({ nodemailer, smtpConfig, logger = console }) {
  async function sendMail(to, subject, html) {
    if (!smtpConfig.host) {
      const preview = String(html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
      logger.log(`\n=== E-MAIL SIMULATION ===\nAn: ${to}\nBetreff: ${subject}\nInhalt: [aus Sicherheitsgründen gekürzt]\nVorschau: ${preview || '(leer)'}\n=========================\n`);
      return true;
    }

    try {
      const transporter = nodemailer.createTransport(smtpConfig);
      await transporter.sendMail({ from: `"DeFi Vault" <${smtpConfig.auth.user}>`, to, subject, html });
      logger.log(`✅ Mail erfolgreich an ${to} gesendet.`);
      return true;
    } catch (error) {
      logger.error('❌ Mail-Fehler beim Senden an', to, ':', error.message);
      logger.error('Stack:', error);
      return false;
    }
  }

  return { sendMail };
}

module.exports = { createMailService };

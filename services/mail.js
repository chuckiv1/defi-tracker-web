function createMailService({ nodemailer, smtpConfig, logger = console }) {
  async function sendMail(to, subject, html) {
    if (!smtpConfig.host) {
      const linkMatch = typeof html === 'string' ? html.match(/href="([^"]*)"/) : null;
      logger.log(`\n=== E-MAIL SIMULATION ===\nAn: ${to}\nBetreff: ${subject}\n${linkMatch ? `Inhalt (Link): ${linkMatch[1]}` : `Inhalt: ${String(html || '').replace(/<[^>]+>/g, ' ').trim().slice(0, 500)}`}\n=========================\n`);
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

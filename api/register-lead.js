const fs = require('fs');
const path = require('path');

module.exports = async (req, res) => {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle pre-flight OPTIONS request
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }

  try {
    const { email } = req.body;
    if (!email || !email.includes('@')) {
      res.status(400).json({ error: 'Email inválido o no suministrado' });
      return;
    }

    console.log(`[MVP VALIDATION] Nuevo lead registrado en Vercel: ${email}`);

    // On Vercel serverless, we can write to /tmp as a transient storage
    const leadsPath = path.join('/tmp', 'leads.json');
    let leads = [];
    
    if (fs.existsSync(leadsPath)) {
      try {
        const fileData = fs.readFileSync(leadsPath, 'utf8');
        leads = JSON.parse(fileData);
      } catch (err) {
        console.error('Error reading /tmp/leads file:', err.message);
      }
    }

    const exists = leads.some(lead => lead.email.toLowerCase() === email.toLowerCase());
    if (!exists) {
      leads.push({
        email: email.toLowerCase(),
        timestamp: new Date().toISOString()
      });
      try {
        fs.writeFileSync(leadsPath, JSON.stringify(leads, null, 2), 'utf8');
      } catch (writeErr) {
        console.warn('Could not write persistent file in ephemeral Vercel environment:', writeErr.message);
      }
    }

    res.status(200).json({ 
      success: true, 
      message: 'Lead registrado exitosamente en Vercel',
      email: email
    });
  } catch (err) {
    console.error('Error in Vercel register-lead serverless function:', err.message);
    res.status(500).json({ 
      error: 'Error interno en Vercel al registrar correo', 
      details: err.message 
    });
  }
};

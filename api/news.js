const { getMacroNews } = require('../server/news');

module.exports = async (req, res) => {
  try {
    // Activar cabeceras CORS para permitir el consumo seguro
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // Manejar peticiones OPTIONS pre-flight automáticas de navegadores
    if (req.method === 'OPTIONS') {
      res.status(200).end();
      return;
    }

    const news = await getMacroNews();
    res.status(200).json(news);
  } catch (err) {
    console.error('Error in Vercel news serverless function:', err.message);
    res.status(500).json({ 
      error: 'Failed to retrieve macroeconomic news', 
      details: err.message 
    });
  }
};

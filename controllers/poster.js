const axios = require("../helpers/axios");
const { getCacheValue, setCacheValue } = require("../helpers/redis");

const poster = async (req, res) => {
  const omdbApiKey = process.env.OMDB_API_KEY;
  const { title, year } = req.body;
  const cacheKey = `poster:${title}:${year}`;
  try {
    const cachedPoster = await getCacheValue(cacheKey);
    if (cachedPoster) {
      console.log("Poster found (cached)");
      res.status(200).json({
        message: "Poster found",
        poster: cachedPoster,
      });
      return;
    }

    if (!title) {
      console.log("No movie title");
      res.status(404).json({ error: "Movie not found" });
      return;
    }
    const response = await axios.get(
      `http://www.omdbapi.com/?t=${title}&y=${year}&apikey=${omdbApiKey}`
    );
    const { Poster } = response.data;
    await setCacheValue(cacheKey, Poster, cacheTtl);
    res.status(200).json({
      message: "Poster found",
      poster: Poster,
    });
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

module.exports = { poster };
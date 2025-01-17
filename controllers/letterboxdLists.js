import axiosHelper from "../helpers/axios.js";
const axios = axiosHelper(true); // Set keepAlive to true
import * as cheerio from "cheerio";
import { getCacheValue, setCacheValue } from "../helpers/redis.js";

const cacheTtl = process.env.CACHE_TTL || 20; // minutes
const postersTtl = process.env.CACHE_TTL || 60; // minutes

const POSTER_WIDTH = 230;
const POSTER_HEIGHT = 345;

const getPosterUrl = (id, titleSlug, cacheBustingKey) => {
  return `https://a.ltrbxd.com/resized/film-poster/${id
    ?.split("")
    ?.join(
      "/"
    )}/${id}-${titleSlug}-0-${POSTER_WIDTH}-0-${POSTER_HEIGHT}-crop.jpg?k=${cacheBustingKey}`;
};

const getFilmData = async (film) => {
  const cacheBustingKey = film.find("div")?.attr("data-cache-busting-key");
  const title = film.find("img")?.attr("alt");
  let titleSlug =
    film.find("div")?.attr("data-target-link") ||
    film.find("div")?.attr("data-film-slug");
  let id = film.find("div")?.attr("data-film-id");
  let year = film.find("div")?.attr("data-film-slug")?.match(/\d{4}/)?.[0];
  const link =
    "https://letterboxd.com" + film.find("div")?.attr("data-target-link");

  let poster;
  if (cacheBustingKey) {
    const url = `https://letterboxd.com/ajax/poster${titleSlug}std/125x187/?k=${cacheBustingKey}`;
    const ajaxResponse = await axios.get(url);
    const $$ = cheerio.load(ajaxResponse.data);
    let filmAux = $$(".film-poster");

    poster = filmAux
      .find("img")
      ?.attr("src")
      ?.replace("125-0-187", `${POSTER_WIDTH}-0-${POSTER_HEIGHT}`);

    // Store the poster URL in Redis
    const posterCacheKey = `letterboxd-poster:${titleSlug}`;
    await setCacheValue(posterCacheKey, poster, postersTtl);

    titleSlug = filmAux?.attr("data-film-link");
    id = filmAux?.attr("data-film-id");
    year = filmAux?.attr("data-film-release-year");
  }

  return { title, year, link, poster, id, titleSlug };
};

const getFilmsCount = ($) => {
  const rawFilmsText = $("h1.section-heading").text();
  return parseInt(rawFilmsText.replace(/[^0-9]/g, ""));
};

const getPageFilms = async ($) => {
  const filmPromises = $(".poster-container")
    .map(async (i, el) => {
      const film = $(el);
      return getFilmData(film);
    })
    .get();

  // prevent losing the entire watchlist if a single film fails to load
  const films = await Promise.allSettled(filmPromises);

  return films
    .filter(({ status }) => status === "fulfilled")
    .map(async ({ value: { title, year, link, poster, id, titleSlug } }) => {
      if (!poster) {
        // Retrieve the poster URL from Redis
        const posterCacheKey = `letterboxd-poster:${titleSlug}`;
        poster = await getCacheValue(posterCacheKey);

        if (!poster) {
          poster = getPosterUrl(id, titleSlug, cacheBustingKey);
        }
      }

      return {
        title,
        year,
        link,
        poster,
      };
    });
};

const fetchList = async (url, cacheKeyPrefix, req, res) => {
  try {
    const { page = 1 } = { ...req.body };
    if (page < 1) return res.status(400).json({ error: "Invalid page number" });

    const maxPages = 20;
    const filmsPerPage = 28; // letterboxd default
    let totalPages = 1;
    let currentPage = 0;
    let filmsCount = 0;
    let filmsPromises = [];
    let lastPage = null;

    for (let index = 0; index < maxPages; index++) {
      currentPage = parseInt(page) + index;
      const cacheKey = `${cacheKeyPrefix}:page:${currentPage}`;
      const cachedList = await getCacheValue(cacheKey);

      if (cachedList) {
        console.log(`List for page ${currentPage} found (cached)`);
        filmsPromises = filmsPromises.concat(cachedList);
      } else {
        const response = await axios.get(`${url}/page/${currentPage}/`);
        const $ = cheerio.load(response.data);
        if (!filmsCount) {
          filmsCount = getFilmsCount($);
          totalPages = Math.ceil(filmsCount / filmsPerPage);
          if (currentPage > totalPages) {
            return res.status(404).json({ error: "Invalid list page" });
          }
        }
        const pageFilmsPromise = await getPageFilms($);

        if (pageFilmsPromise.length === 0) {
          break;
        }
        Promise.all(pageFilmsPromise).then((pageFilms) => {
          setCacheValue(cacheKey, pageFilms, cacheTtl);
        });
        filmsPromises = filmsPromises.concat(pageFilmsPromise);
      }
    }

    const films = await Promise.all(filmsPromises);
    res.status(200).json({
      message: "List found",
      watchlist: films,
      lastPage: Math.min(currentPage, totalPages),
      totalPages: totalPages || lastPage,
    });
  } catch (error) {
    console.error(error);
    if (error?.response?.status === 404) {
      res.status(404).json({ error: "List not found" });
      return;
    }
    res.status(500).json({ error: "Internal Server Error" });
  }
};

export const letterboxdWatchlist = async (req, res) => {
  const { username, listUrl, listType } = { ...req.body };
  if (!username) return res.status(400).json({ error: "Watchlist file not found" });

  // const url = `https://letterboxd.com/${username}/watchlist/by/popular`;
  const cacheKeyPrefix = `watchlist:${username}_${listType}`;
  await fetchList(listUrl, cacheKeyPrefix, req, res);
};

export const letterboxdCustomList = async (req, res) => {
  const { username, listUrl, listType } = { ...req.body };
  if (!listUrl) return res.status(400).json({ error: "Custom list URL not found" });

  const cacheKeyPrefix = `customlist:${username}_${listType}`;
  await fetchList(listUrl, cacheKeyPrefix, req, res);
};
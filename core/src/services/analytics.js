/**
 * 数据分析模块 - 作物效率分析
 */

const { getAllPlants, getFruitPrice, getSeedPrice, getItemById, getItemImageById } = require('../config/gameConfig');

function parsePhaseDurations(growPhases) {
    if (!growPhases) return [];
    return String(growPhases)
        .split(';')
        .map(segment => String(segment || '').trim())
        .filter(Boolean)
        .map((segment) => {
            const match = segment.match(/:(\d+)$/);
            return match ? Number.parseInt(match[1], 10) || 0 : 0;
        })
        .filter(duration => duration >= 0);
}

function parseGrowTime(growPhases) {
    return parsePhaseDurations(growPhases)
        .reduce((total, duration) => total + duration, 0);
}

function parseRegrowSec(growPhases, seasons) {
    if ((Number(seasons) || 1) <= 1) return 0;
    const durations = parsePhaseDurations(growPhases).filter(duration => duration > 0);
    if (!durations.length) return 0;
    return durations[durations.length - 1];
}

function parseNormalFertilizerReduceSec(growPhases) {
    const durations = parsePhaseDurations(growPhases).filter(duration => duration > 0);
    return durations.length > 0 ? durations[0] : 0;
}

function formatTime(seconds) {
    if (seconds < 60) return `${seconds}秒`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}分${seconds % 60}秒`;
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    return mins > 0 ? `${hours}时${mins}分` : `${hours}时`;
}

function round2(value) {
    return Number.parseFloat(Number(value || 0).toFixed(2));
}

function getUnlockLevel(plant) {
    const seedItem = getItemById(plant.seed_id);
    const seedItemLevel = Number(seedItem && seedItem.level);
    if (Number.isFinite(seedItemLevel) && seedItemLevel > 0) return seedItemLevel;

    const configLevel = Number(plant.land_level_need);
    if (Number.isFinite(configLevel) && configLevel > 0) return configLevel;

    return null;
}

function isNormalPlant(plant) {
    if (!plant || !plant.seed_id || !plant.grow_phases) return false;
    if (String(plant.id).startsWith('2020')) return false;

    const seedItem = getItemById(plant.seed_id);
    if (seedItem && Number(seedItem.price) === 0) return false;

    return true;
}

function getPlantRankings(sortBy = 'exp') {
    const plants = getAllPlants();
    const normalPlants = plants.filter(isNormalPlant);
    const results = [];

    for (const plant of normalPlants) {
        const firstHarvestTime = parseGrowTime(plant.grow_phases);
        if (firstHarvestTime <= 0) continue;

        const seasons = Math.max(1, Number(plant.seasons) || 1);
        const regrowSec = parseRegrowSec(plant.grow_phases, seasons);
        const totalTimeSec = firstHarvestTime + ((seasons - 1) * regrowSec);
        if (totalTimeSec <= 0) continue;

        const expPerHarvest = Number.parseInt(plant.exp, 10) || 0;
        const totalExp = expPerHarvest * seasons;
        if (totalExp <= 0) continue;

        const reduceSecBase = parseNormalFertilizerReduceSec(plant.grow_phases);
        const reduceSecApplied = reduceSecBase * seasons;
        const fertilizedGrowTime = Math.max(1, totalTimeSec - reduceSecApplied);

        const fruitId = Number(plant.fruit && plant.fruit.id) || 0;
        const fruitCountPerHarvest = Number(plant.fruit && plant.fruit.count) || 0;
        const totalFruitCount = fruitCountPerHarvest * seasons;
        const fruitPrice = getFruitPrice(fruitId);
        const seedPrice = getSeedPrice(Number(plant.seed_id) || 0);
        const income = totalFruitCount * fruitPrice;
        const netProfit = income - seedPrice;

        results.push({
            id: plant.id,
            seedId: plant.seed_id,
            name: plant.name,
            seasons,
            level: getUnlockLevel(plant),
            growTime: totalTimeSec,
            growTimeStr: formatTime(totalTimeSec),
            firstHarvestTime,
            regrowSec,
            totalTimeSec,
            expPerHarvest,
            totalExp,
            reduceSec: reduceSecBase,
            reduceSecApplied,
            expPerHour: round2((totalExp / totalTimeSec) * 3600),
            normalFertilizerExpPerHour: round2((totalExp / fertilizedGrowTime) * 3600),
            goldPerHour: round2((income / totalTimeSec) * 3600),
            profitPerHour: round2((netProfit / totalTimeSec) * 3600),
            normalFertilizerProfitPerHour: round2((netProfit / fertilizedGrowTime) * 3600),
            income,
            netProfit,
            fruitId,
            fruitCount: totalFruitCount,
            fruitCountPerHarvest,
            fruitPrice,
            seedPrice,
            image: getItemImageById(plant.seed_id),
        });
    }

    if (sortBy === 'exp') {
        results.sort((a, b) => b.expPerHour - a.expPerHour);
    } else if (sortBy === 'fert') {
        results.sort((a, b) => b.normalFertilizerExpPerHour - a.normalFertilizerExpPerHour);
    } else if (sortBy === 'gold') {
        results.sort((a, b) => b.goldPerHour - a.goldPerHour);
    } else if (sortBy === 'profit') {
        results.sort((a, b) => b.profitPerHour - a.profitPerHour);
    } else if (sortBy === 'fert_profit') {
        results.sort((a, b) => b.normalFertilizerProfitPerHour - a.normalFertilizerProfitPerHour);
    } else if (sortBy === 'level') {
        const toLevel = value => (value === null || value === undefined ? -1 : Number(value));
        results.sort((a, b) => toLevel(b.level) - toLevel(a.level));
    }

    return results;
}

module.exports = {
    getPlantRankings,
};

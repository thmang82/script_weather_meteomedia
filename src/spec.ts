import { DataSource } from '@script_types/spec/spec_source';
import { stations } from './spec_stations';

export const specification: DataSource.Specification = {
    category:  "weather",
    id_ident:  "meteomedia",
    id_author: "thmang82",
    // ---
    provides: [ "weather_forecast", "weather_now" ],
    // ---
    version:   "0.1.2",
    // ---
    translations: {
        'en': { name: "MeteoMedia Weather Forecast", description: "Weather data from MeteoMedia Websites" }
    },
    // ---
    parameters: [
       {
           ident: "station",
           auto_complete: true,
           type: "DropDownList",
           translations: {
               'en': { name: "Weather Station", description: "Select a weather station" }
           },
           value_type: "string",
           entries: stations,
           req_source: false
       }
    ],
    notifications: [],
    geo_relevance: {
        everywhere: false,
        countries: [ "DE" ],
        cities: []
    },
    data_fetch: {
        interval_active_sec:  5 * 60,
        interval_idle_sec:   15 * 60
    }
}
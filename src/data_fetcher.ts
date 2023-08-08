import { Script } from "@script_types/script/script"
import { ScriptConfig } from "../gen/spec_config"
import { ScriptCtxUI } from "@script_types/script/context_ui/context_ui";
import { SourceWeatherForecast } from "@script_types/sources/weather/source_weather_forecast";
import { TypesWeather } from "@script_types/sources/weather/types_weather";
import { processRetrievedData } from "./data_process";


export interface WeatherResponse extends SourceWeatherForecast.Data {
    current: TypesWeather.DataCurrent;
}

type RequestResult = WeatherResponse | { error: string, info: undefined };

export enum ReqType {
    Current  = "Current",
    Sunshine = "Sunshine",
    Temps    = "Temps",
    Humidity = "Humidity",
    Wind     = "Wind",
    Winddir  = "Winddir",
    Precipitation = "Precipitation"
}

export interface RetrievedData { 
    type: ReqType, 
    xml:  string | undefined
};

export class DataFetcher {
    private ctx: Script.Context;
    private config: ScriptConfig;

    private tz_offset_global: number | undefined;

    private data_time_ms: number | undefined;
    private request_promise: Promise<RequestResult> | undefined;


    constructor(ctx: Script.Context, config: ScriptConfig) {
        this.ctx = ctx;
        this.config = config;
    }

    public start = async () => {

    }
    
    public stop = async () => {
        console.info("Stopping all my stuff ...");
    }

  
    private requestData = async (type: "forecast" | "current") => {
        const station_id = this.config.station;
        if (station_id) {
            const station_num = station_id.value.replace(/[^\d]/g,"");
            if (this.request_promise && this.data_time_ms && (Date.now() - this.data_time_ms) < 1000) {
                return this.request_promise;
            } else {
                this.data_time_ms = Date.now();
                return this.request_promise = this.getForecastOrNow(station_num, type);
            }
        } else {
            console.warn("Station not defined in configuration!");
        }
    }

    private getForecastOrNow = async (station_id: string, type: "forecast" | "current"): Promise<RequestResult> => {
        return new Promise<RequestResult>(async resolve => {
            const obj: RequestResult = await this.doNewDataRequest(station_id);
            console.log(`getForecastOrNow() type: '${type}' for ${station_id} => `, JSON.stringify(obj).substr(0, 100) + "...");
            resolve(obj);
        })
    }

    private doNewDataRequest = async (station_id: string): Promise<RequestResult> => {  
        const self = this;  
        const debug = false;

        const log_prefix = "SourceWeatherMeteoGroup|doNewDataRequest|" + station_id +": ";
        let types: ReqType[] = [ReqType.Current, ReqType.Sunshine, ReqType.Temps, ReqType.Humidity, ReqType.Wind, ReqType.Winddir, ReqType.Precipitation];
       
        let retrieved_data: RetrievedData[] = [];
        const t_start = Date.now();

        let retrieve_promises = [];
        async function getData(url: string, pos: number, retry_count: number){
            let error_count = 0;
            let data_fetched = false;
            const timeout_ms = 10000;
            const header = { 'content-type': 'application/x-www-form-urlencoded' };
            while (!data_fetched && error_count < retry_count) {
                try {
                    const result = await self.ctx.data.http.getStr(url, timeout_ms, header);
                    if (result.statusCode == 200) {
                        retrieved_data[pos].xml = result.body;
                        data_fetched = true;
                    } else {
                        console.error(log_prefix + `ERROR: non200, code: ${result.statusCode} ${result.body}`)
                        error_count++;
                    }
                } catch (e) {
                    console.error(log_prefix + `ERROR: catched`, e.code ? e.code : e);
                    error_count++;
                }
            }
        }
        for (let t = 0; t < types.length; t++) {
            let req_type = types[t];
            retrieved_data.push({type: req_type, xml: undefined});
            let time_zone_offset = -2; // is always -2 in web, do not ask me why!
            this.tz_offset_global = time_zone_offset;
            if (req_type == ReqType.Sunshine) {
                time_zone_offset = -1; //  but seems to need -1 when sunshine shall be aligned,
            }
            if (req_type == ReqType.Precipitation) {
                time_zone_offset = -3; // do not ask me why, but it is needed to align the Precipitation data
            }
            let url = "http://data.meteomedia.de/details/AnychartData.php?wmo1=" + station_id + "&type=" + req_type + "&lang=de&offset=" + time_zone_offset;
            if (req_type == ReqType.Current) {
                // const base_url = "http://www.meteo-info.be/";
                const base_url = "http://www.meteocentrale.ch/";
                url = base_url + "de/europa/deutschland/wetter-muenchen-neuhausen/details/S" + station_id;
                // http://www.meteocentrale.ch/
                console.log(log_prefix + url);
            }
           
            const max_retry = 3;
            retrieve_promises.push(getData(url, t, max_retry));
        }
        await Promise.all(retrieve_promises);
        const duration_ms = Date.now() - t_start;
        console.log(log_prefix + `finished ${types.length} requests in ${duration_ms} ms for Station ${station_id}`);
        const offset_tz = this.tz_offset_global ? this.tz_offset_global : 0;
        const data = await processRetrievedData(station_id, retrieved_data, debug, offset_tz);
        return data;
    }

    public dataRequest_WeatherForecast: ScriptCtxUI.DataRequestCallback<"weather_forecast"> = async (_req_params) => {
        let data = await this.requestData("forecast");
        if (data && data.info){
            return {
                info: data.info,
                time: data.time,
                daily_arr: data.daily_arr,
                hourly_arr: data.hourly_arr,
                hourly_resolution: data.hourly_resolution
            }
        }
        return undefined;
    }

    public dataRequest_WeatherNow: ScriptCtxUI.DataRequestCallback<"weather_now">= async (_req_params) => {
        let data = await this.requestData("current");
        if (data && data.info){
            return {
                info: data.info,
                time: data.time,
                now:  data.current
            }
        }
        return undefined;
    }
}
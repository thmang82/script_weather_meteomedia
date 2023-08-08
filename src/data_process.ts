import moment from 'moment';
import * as xpath from 'xpath';
import * as dom from 'xmldom';

import { TypesWeather } from '@script_types/sources/weather/types_weather';
import { RetrievedData, WeatherResponse } from './data_fetcher';
import { IconMap } from './icon_map';
import { getMinMaxAvg } from './statistics';

const help = {
    getIsoTimeStringFromUnixEpoch: function(unixepoch: number){
        var d = new Date(unixepoch*1000);
        var n = d.toISOString();
        return n;
    }
}

export async function processRetrievedData (station_id: string, retrieved_data: RetrievedData[], debug: boolean, tz_offset_global: number): Promise<WeatherResponse> {
        const log_prefix = "processRetrievedData: ";
        const t_global_start = Date.now();

        const dom_parser = new dom.DOMParser()
        
        let obj_data_arr: RetrievedData[] = retrieved_data;

        let c_info: TypesWeather.DataInfo = {
            station_id: station_id,
            station_name: ""
        }
        let val_undef = -99;
        let c_current: TypesWeather.DataCurrent = {
            temp: val_undef,
            humidity: val_undef,
            icon_id: "",
            precip_mm: val_undef,
            sun_percentage: val_undef,
            wind_kmh: val_undef
        }

        interface DataCache  {
            t_epoch_local: number,
            t_iso_local:   string,
            temp?: string, 
            temp_dew?: string, 
            temp_min?: string, 
            temp_max?: string, 
            wind_dir_tag?: string,
            precip_l_6h?:  string,
            precip_l_1h?:  string,
            sunshine_min?: string,
            wind_dir?:     string,
            wind_kmh?:     string,
            icon_id?:      string,
            humidity?:     string
        }

        let c_obj: {
            "hourly": {[time_str: number]: DataCache},
            "daily":  {[time_str: number]: DataCache},
            "3hours": {[time_str: number]: DataCache},
            "6hours": {[time_str: number]: DataCache}
        } = {
            "hourly": {},
            "daily":  {},
            "3hours": {},
            "6hours": {}
        };
        let wind_dir_tags = { south: 180, south_west: 225, west: 270, north_west: 315, north: 0, north_east: 45, east: 90, south_east: 135 };
        let time_str_to_icon = {};

        function addToElem(interval: string, epoch: string, store_tag: string, value: string) {
            let elem = c_obj[interval][epoch];
            if (elem === undefined) {
                let insert_t: DataCache = {
                    t_epoch_local: parseInt(epoch),
                    t_iso_local: help.getIsoTimeStringFromUnixEpoch(parseInt(epoch))
                }
                c_obj[interval][epoch] = insert_t;
            }
            c_obj[interval][epoch][store_tag] = value;
        }
        function procesSeries(doc_points: Node[], interval: string, store_tag: string) {
            if (debug) { console.log("Process: " + interval  + "  " + store_tag); };
            for (let d = 0; d < doc_points.length; d++) {
                let epoch = (<Attr>xpath.select1("@x", doc_points[d])).value;
                let value = parseFloat("" + (<Attr>xpath.select1("@y", doc_points[d])).value);
                //let date = new Date(epoch*1000);
                //console.log(epoch +" -> "+value + " (" + date.toISOString() + ")");
                addToElem(interval, epoch, store_tag, "" + value);
                if (store_tag == "precip_l_6h") {
                    addToElem(interval, epoch, "precip_l_1h", "" + (value / 6.0));
                }
            }
        }

        function procesSeriesWind(doc_points: Node[], interval: string) {
            for (let d = 0; d < doc_points.length; d++) {
                let epoch = (<Attr>xpath.select1("@x", doc_points[d])).value;
                let value = (<Attr>xpath.select1("marker/@style", doc_points[d])).value;
                addToElem(interval, epoch, "wind_dir_tag", value);
                addToElem(interval, epoch, "wind_dir", wind_dir_tags[value]);
            }
        }
        function getGenericIconId(mm_icon_id: string): string {
            if (mm_icon_id.indexOf("gkmss") != -1) {
                return IconMap.gkmss_icon_ids[mm_icon_id];
            } else {
                return IconMap.detail_icon_ids[mm_icon_id];
            }
        }

        // Pre process the received data:
        let t_start_last = Date.now();
        for (let i = 0; i < obj_data_arr.length; i++) {
            let xml =  obj_data_arr[i].xml;
            let type = obj_data_arr[i].type;
            if (!xml){
                console.error(log_prefix + " NoDataForType " + type);
                continue;
            }
            console.log(log_prefix + `process ${i} of ${obj_data_arr.length} type ${type}, last took ${Date.now() - t_start_last}`);
            t_start_last = Date.now();
            let cleanedXml = xml.replace("\ufeff", "");
            cleanedXml = cleanedXml.replace(/&nbsp;/g, ' '); // replaces &nbsp; 
            cleanedXml = cleanedXml.replace(/&copy;/g, ' ');
            //console.log(cleanedXml);

            const t_parse_start = Date.now();
            let doc = dom_parser.parseFromString(cleanedXml);
            if (debug) {
                console.log(log_prefix + `xml parse took ${Date.now() - t_parse_start} ms`);
            }
           
            if (type == "Temps") {
                // The Temperature
                let doc_points = xpath.select("//charts/chart/data/series[@name='80b']/point", doc);
                procesSeries(<Node[]> doc_points, "3hours", "temp");
                // The dew_point
                let doc_points_dew = xpath.select("//charts/chart/data/series[@name='80c']/point", doc);
                procesSeries(<Node[]> doc_points_dew, "3hours", "temp_dew");
                // The daily min
                let doc_points_tmin = xpath.select("//charts/chart/data/series[@name='80d']/point", doc);
                procesSeries(<Node[]> doc_points_tmin, "daily", "temp_min");
                // The daily max
                let doc_points_tmax = xpath.select("//charts/chart/data/series[@name='80e']/point", doc);
                procesSeries(<Node[]> doc_points_tmax, "daily", "temp_max");
            }
            if (type == "Humidity") {
                // The Temperature
                let doc_points = xpath.select("//charts/chart/data/series[@name='80b']/point", doc);
                procesSeries(<Node[]> doc_points, "3hours", "humidity");
            }
            if (type == "Sunshine") {
                // The Temperature
                let doc_points = xpath.select("//charts/chart/data/series[@name='80b']/point", doc);
                procesSeries(<Node[]> doc_points, "hourly", "sunshine_min");
            }
            if (type == "Wind") {
                // The Temperature
                let doc_points = xpath.select("//charts/chart/data/series[@name='80b']/point", doc);
                procesSeries(<Node[]> doc_points, "3hours", "wind_kmh");
                let doc_points_gust = xpath.select("//charts/chart/data/series[@name='80c']/point", doc);
                procesSeries(<Node[]> doc_points_gust, "3hours", "wind_gust_kmh");
            }
            if (type == "Precipitation") {
                // The Temperature
                let doc_points = xpath.select("//charts/chart/data/series[@name='80b']/point", doc);
                procesSeries(<Node[]> doc_points, "6hours", "precip_l_6h");
            }
            if (type == "Winddir") {
                // The Temperature
                let doc_points = xpath.select("//charts/chart/data/series[@name='80b']/point", doc);
                procesSeriesWind(<Node[]> doc_points, "6hours");
            }

            if (type == "Current") {
                //console.log(xml);
                let doc_now: Node = <Node> xpath.select1("//div[@id='weather-detail-summary']", doc);
                //console.log(doc_now);
                //console.log(xmlserializer.serializeToString(doc_now));
                let temp: string | undefined = undefined;
                // let rain: string | undefined = undefined;
                if (doc_now) {
                    try {
                        let doc_loc = <Node> xpath.select1(".//div[@class='weather-detail-location']", doc_now);
                        if (debug) { console.log("Search Location:"); };
                        if (doc_loc && doc_loc.firstChild) {
                            let value = doc_loc.firstChild.nodeValue;
                            c_info.station_name = value ? value : "";
                            if (debug) { console.log("Extracted Station Name: " + value); };
                        }
                        let doc_temp = <Node>xpath.select1(".//div[@class='column-4']", doc_now); // <div class="column-4">22<span>°C</span></div>
                        //console.log(doc_temp);
                        //console.log(xmlserializer.serializeToString(doc_temp));
                        temp = doc_temp.firstChild && doc_temp.firstChild.nodeValue ? doc_temp.firstChild.nodeValue : undefined;
                        //console.log("Temp tag: " + temp); 
                        if (temp){
                            c_current.temp = parseFloat(temp);
                        }

                        let doc_icon = <Node> xpath.select1(".//div[@class='column-3']/center/div", doc_now);
                        let icon_class = (<Attr>xpath.select1("@class", doc_icon)).value;
                        // let icon_text  = (<Attr>xpath.select1("@title", doc_icon)).value;
                        if (debug) { console.log("icon_class:", icon_class); };
                        c_current.icon_id   = getGenericIconId(icon_class);

                        let doc_spans = <Node[]> xpath.select(".//div[@class='column-2']/span", doc_now);
                        //console.log(xmlserializer.serializeToString(doc_spans))
                        for (let s in doc_spans) {
                            let node = doc_spans[s];
                            let str = node.firstChild ? node.firstChild.nodeValue : undefined;
                            //console.log(str);
                            let arr = str ? (/([^ ]*) ([^ ]*)/g).exec(str) : undefined;
                            if (arr && arr.length > 2) {
                                let value = arr[1];
                                let unit  = arr[2];
                                if (unit[0] == "l") {
                                    c_current.precip_mm = parseFloat(value);
                                }
                                if (unit[0] == "k") {
                                    c_current.wind_kmh = parseFloat(value);
                                }
                                if (unit[0] == "%") {
                                    c_current.humidity = parseFloat(value);
                                }
                            }
                            //console.log(arr);
                        }
                    } catch (e) {
                        console.log("Error while searching for current conditions: ", e);
                    }
                }

                // Read the table to extract the symbols
                if (1) {
                    try {
                        if (debug) { console.log("Extract the Symbols from Table ..."); };
                        let doc_tabs = <Node>xpath.select1("//div[@class='tabs']", doc);
                        let doc_table_container = <Node> xpath.select1("//div[@class='detail-table-container']", doc);

                        if (doc_tabs && doc_table_container) {
                            let doc_tabs_arr = <Node[]> xpath.select(".//div[contains(@class,'tab')]", doc_tabs);

                            let tables_arr = [];
                            for (let tab in doc_tabs_arr) {
                                let doc_tab = doc_tabs_arr[tab];
                                let tab_date = (<Attr>xpath.select1("@title", doc_tab));
                                if (tab_date) {
                                    tables_arr.push({
                                        date_str: tab_date.value
                                    });
                                }
                            }
                            if (debug) { console.log("tables_arr:", tables_arr); };
                            let doc_tables_arr = <Node[]> xpath.select(".//table[contains(@class,'detail-table')]", doc_table_container);
                            let t_i = 0;
                            for (let table in doc_tables_arr) {
                                let doc_table = doc_tables_arr[table];
                                let doc_times_arr: Node[] = <Node[]> xpath.select(".//td[@class='time']", doc_table);
                                //console.log("  DocTimes:",doc_times_arr.length);
                                let doc_icons_arr = <Node[]>xpath.select(".//td/center/div[contains(@class,'mm_gkmss')]", doc_table);
                                //console.log("  DocIcons:",doc_icons_arr.length);
                                let table_obj;
                                if (t_i < tables_arr.length) {
                                    table_obj = tables_arr[t_i];
                                }
                                if (table_obj) {
                                    if (doc_times_arr.length == doc_icons_arr.length && doc_icons_arr.length > 3) {
                                        let last_valid_hour = -1;
                                        for (let t = 0; t < doc_times_arr.length; t++) {
                                            let doc_time: Node = doc_times_arr[t];
                                            //console.log(xpath.select1("./div",doc_time));
                                            let hhmm_start_str = (<Node>xpath.select1("./div", doc_time)).firstChild?.nodeValue;
                                            let hhmm_end_str   =  (<Node>xpath.select1("./div[@class='time-until']", doc_time)).firstChild?.nodeValue;
                                            hhmm_end_str = hhmm_end_str ? hhmm_end_str.replace("-", "") : "";
                                            let start_hour = hhmm_start_str ? parseInt(hhmm_start_str.substring(0, 2)): 0;
                                            let start_hour_corrected = start_hour + tz_offset_global;
                                            let doc_icon = doc_icons_arr[t];
                                            let icon_name = (<Attr> xpath.select1("@class", doc_icon)).value;
                                            if (start_hour_corrected > last_valid_hour) {
                                                // not into next day, lets use this
                                                let leading_zero_hour = start_hour_corrected < 10 ? "0" + start_hour_corrected : start_hour_corrected;
                                                let time_str_iso = table_obj.date_str + "T" + leading_zero_hour + ":00:00.000Z";
                                                if (debug) { console.log(time_str_iso + " (End:" + hhmm_end_str + ") => " + icon_name); };
                                                time_str_to_icon[time_str_iso] = getGenericIconId(icon_name);

                                                last_valid_hour = start_hour_corrected;
                                            }
                                        }
                                    }
                                }
                                t_i++;
                            }
                        }
                    } catch (e) {
                        console.log("Error while searching for Icons of 3hours: ", e);
                    }
                }
            }// end of "current"
        }

        if (debug) { console.log("c_obj after parsing:", c_obj); };

        function convertToArray(interval: string): DataCache[] {
            let ret_arr: DataCache[] = [];
            for (let o in c_obj[interval]) {
                ret_arr.push(c_obj[interval][o]);
            }
            return ret_arr;
        }

        let daily_data:  DataCache[] = convertToArray("daily");
        let hourly_data: DataCache[] = convertToArray("hourly");
        let hours6_data: DataCache[] = convertToArray("6hours");
        let hours3_data: DataCache[] = convertToArray("3hours");

        if (debug){
            console.log("daily_data:",  daily_data.length > 2 ? [daily_data[0],daily_data[1]] : undefined);
            console.log("hourly_data:", hourly_data.length > 2 ? [hourly_data[0],hourly_data[1]] : undefined);
            console.log("hours6_data:", hours6_data.length > 2 ? [hours6_data[0],hours6_data[1]] : undefined);
            console.log("hours3_data:", hours3_data.length > 2 ? [hours3_data[0],hours3_data[1]] : undefined);
        }

        let daily_data_map: {[time:string]: TypesWeather.DataDay} = {};
        let daily_wind_tmp     = {};
        let daily_humidity_tmp = {};
        let daily_weather_tmp: {[day_str: string]: {
            daylight: boolean,
                    rain: boolean,
                    snow: boolean,
                    severe_max: number,
                    strength_max: number,
                    thunder: boolean,
                    cover_sum: number,
                    cover_count: number
                    cover_percent: number[],
        }} = {};

        // Compute the daily data:

        let t_now_epoch        = moment().valueOf() / 1000.0;
        let t_now_epoch_local  = (moment().valueOf() / 1000.0 + moment().utcOffset() * 60);
        let t_today_str        = moment().format("YYYY-MM-DD");
        let t_now_hour_str     = moment().format("hh");

        for (let i = 0; i < daily_data.length; i++) {
            let obj_t = daily_data[i];
            let day_time_str: string = obj_t.t_iso_local.substring(0, 10); // get 2017-04-20 from 2017-04-20T06:00:00.000Z
            let day_obj: TypesWeather.DataDay | undefined = daily_data_map[day_time_str];
            // let t_day_epoch       = (moment(day_time_str).valueOf() / 1000.0).toFixed(0);
            let t_day_epoch_local = Math.ceil(moment(day_time_str).valueOf() / 1000.0 + moment(day_time_str).utcOffset() * 60);

            if (!day_obj) {
                day_obj = {
                    day: day_time_str,
                    day_epoch_local: t_day_epoch_local,
                    sun_hours:  { whole_day:  -1, remaining: 0},
                    precip_l:   { whole_day:  -1, remaining: 0},
                    wind_kmh:   { avg: -1, max: -1, min: -1 },
                    wind_dir:   -1,
                    humidity:   { avg: -1, max: -1, min: -1 },
                    temp_deg:   { avg: -1, max: -1, min: -1 },
                    icon_id: "",
                    conditions: {
                        rain: false,
                        snow: false,
                        thunder: false
                    }
                };
                daily_data_map[day_time_str] = day_obj;
                daily_wind_tmp[day_time_str] = { vect_x: 0, vect_y: 0, sum_kmh: 0, max_kmh: 0, count: 0 };
                daily_humidity_tmp[day_time_str] = { h_max: 0, h_sum: 0, h_min: 100, count: 0 };
            }
            if (obj_t.temp_min !== undefined){
                day_obj.temp_deg.min = parseFloat(obj_t.temp_min);
            }
            if (obj_t.temp_max !== undefined) {
                day_obj.temp_deg.max = parseFloat(obj_t.temp_max);
            }
        }

        let c_hourly_map: {[timstr: string]: TypesWeather.DataHourly} = {};
        for (let i = 0; i < hourly_data.length; i++) {
            let obj_t = hourly_data[i];
            const epoch_local = obj_t.t_epoch_local;
            let hourly_o: TypesWeather.DataHourly = {
                t_epoch_local: obj_t.t_epoch_local,
                t_iso_local:   obj_t.t_iso_local
            }
            const sunshine_min_num = obj_t.sunshine_min ? parseInt(obj_t.sunshine_min) : 0;
            hourly_o.sunshine_min = sunshine_min_num;
            if (!c_hourly_map[epoch_local]){
                c_hourly_map[epoch_local] = hourly_o;
            }
            let day   = obj_t.t_iso_local.substring(0, 10); // get 2017-04-20 from 2017-04-20T06:00:00.000Z
            let day_obj = daily_data_map[day];
            if (day_obj) {
                if (day_obj.sun_hours.whole_day < 0) day_obj.sun_hours.whole_day = 0; // set the inital 0 value. Is -1 before. -1 allows the frontend to see: was not set
                day_obj.sun_hours.whole_day += (sunshine_min_num / 60);
                if (day === t_today_str) {
                    let sec_in_future = obj_t.t_epoch_local - t_now_epoch_local;
                    if (sec_in_future > 0) {
                        let frac = sec_in_future < 3600 ? sec_in_future / 3600 : 1;
                        day_obj.sun_hours.whole_day += (sunshine_min_num / 60) * frac;
                    }
                }
            }
            if (day === t_today_str) {
                // add the sun Percentage of the current hourly
                let hour_str = obj_t.t_iso_local.substring(11, 13);
                //console.log("hour_str:" + hour_str + "  --- t_now_hour_str:"+t_now_hour_str + " obj_t.sunshine_min:"+obj_t.sunshine_min);
                if (t_now_hour_str == hour_str) {
                    let sun_p = Math.ceil((sunshine_min_num / 60.0) * 100.0);
                    //console.log("Match - sun_p:",sun_p);
                    if (sun_p > 100) sun_p = 100;
                    c_current.sun_percentage = sun_p;
                }
            }
        }
        let time_epoch_to_wind_dir = {};
        for (let i = 0; i < hours6_data.length; i++) {
            let obj_t = hours6_data[i];
            let day_time_str = obj_t.t_iso_local.substring(0, 10); // get 2017-04-20 from 2017-04-20T06:00:00.000Z
            let day_obj = daily_data_map[day_time_str];
            // there is a 1 to 2 hours shift. However, lets ignore this. Just add it to the day.
            if (day_obj && obj_t.hasOwnProperty("precip_l_6h")) {
                const precip_l_6h = obj_t.precip_l_6h ? parseFloat(obj_t.precip_l_6h) : 0;
                if (day_obj.precip_l.whole_day < 0) day_obj.precip_l.whole_day = 0; // set the inital 0 value. Is -1 before. -1 allows the frontend to see: was not set
                day_obj.precip_l.whole_day += precip_l_6h;
                if (day_time_str === t_today_str) {
                    let sec_in_future = obj_t.t_epoch_local - t_now_epoch_local;
                    if (sec_in_future > 0) {
                        let frac = sec_in_future < (6 * 3600) ? sec_in_future / (6 * 3600) : 1;
                        day_obj.precip_l.remaining += (precip_l_6h / 60) * frac;
                    }
                }
            }
            if (obj_t.hasOwnProperty("wind_dir")) {
                time_epoch_to_wind_dir[obj_t.t_epoch_local] = obj_t.wind_dir;
                time_epoch_to_wind_dir[obj_t.t_epoch_local + 3 * 3600] = obj_t.wind_dir;
            }
             // enrich the hourly graph with the data: 
             for (let add = 0; add < 6; add++){
                let time_t = obj_t.t_epoch_local + add * 3600;
                let obj_h = c_hourly_map[time_t];
                if (debug){
                    console.log("6hour obj", obj_t.t_epoch_local, time_t, obj_h);
                }
                if (obj_h){
                    if (obj_t.precip_l_1h !== undefined){
                        obj_h.precip_l = Math.floor(parseFloat(obj_t.precip_l_1h)*100)/100;
                    }
                    if (obj_t.wind_dir !== undefined){
                        obj_h.wind_dir_deg = parseFloat(obj_t.wind_dir);
                    }
                    if (obj_t.wind_dir_tag !== undefined){
                        obj_h.wind_dir_tag = obj_t.wind_dir_tag;
                    }
                }
            }
        }

        const severe_mapping: {[key: string]: number} = {
            "_clear": 0,
            "_clouds": 1,
            "_sandy": 2,
            "_fog": 3,
            "_rain": 4,
            "_snow": 5,
            "_snowrain": 6
        };
        const strength_mapping: {[key: string]: number} = {
            "_drizzle": 0,
            "_light": 1,
            "_full": 2
        }
        const cover_mapping: {[key: string]: number} = {
            "_spots":  0,
            "_partly": 1,
            "_coated": 2
        };
        const cover_percent_mapping: {[key: string]: number} = {
            "_spots":  30,
            "_partly": 65,
            "_coated": 100
        };

        for (let i = 0; i < hours3_data.length; i++) {
            let obj_t = hours3_data[i];
            
            obj_t.icon_id = time_str_to_icon[obj_t.t_iso_local];
            if (debug) { console.log("Icon ID of 3 hour: " + obj_t.t_iso_local + " -> " + obj_t.icon_id); };
            let day_time_str = obj_t.t_iso_local.substring(0, 10); // get 2017-04-20 from 2017-04-20T06:00:00.000Z

            let wind_kmh = obj_t.wind_kmh ? parseInt(obj_t.wind_kmh) : -1;
            let wind_dir = time_epoch_to_wind_dir[obj_t.t_epoch_local];

            if (wind_dir && wind_kmh) {
                let dir_rad = wind_dir * Math.PI / 180;
                let vect_x = Math.sin(dir_rad) * wind_kmh;
                let vect_y = Math.cos(dir_rad) * wind_kmh;
                let wind_obj_t = daily_wind_tmp[day_time_str];
                if (wind_obj_t) {
                    wind_obj_t.vect_x += vect_x;
                    wind_obj_t.vect_y += vect_y;
                    wind_obj_t.sum_kmh += wind_kmh;
                    if (wind_kmh > wind_obj_t.max_kmh) wind_obj_t.max_kmh = wind_kmh;
                    wind_obj_t.count++;
                }
            }
            let humid_obj_t = daily_humidity_tmp[day_time_str];
            let humidity    = obj_t.humidity ? parseFloat(obj_t.humidity) : -1;
            if (humid_obj_t) {
                humid_obj_t.count ++;
                humid_obj_t.h_sum += humidity;
                if (humidity > humid_obj_t.h_max) humid_obj_t.h_max = humidity;
                if (humidity < humid_obj_t.h_min) humid_obj_t.h_min = humidity;
            }

            if (!daily_weather_tmp.hasOwnProperty(day_time_str)) {
                daily_weather_tmp[day_time_str] = {
                    daylight: false,
                    rain: false,
                    snow: false,
                    severe_max: -1,
                    strength_max: -1,
                    thunder: false,
                    cover_sum: 0,
                    cover_count: 0,
                    cover_percent: [],
                };
            }


            let day_obj = daily_weather_tmp[day_time_str];
            let icon_id = obj_t.icon_id;
            let cloud_cover_percent: number | undefined;
            if (day_obj && icon_id) {
                if (!day_obj.daylight) day_obj.daylight = icon_id.search("day_") > -1;
                if (!day_obj.snow) day_obj.snow = icon_id.search("snow") > -1;
                if (!day_obj.rain) day_obj.rain = icon_id.search("rain") > -1;
                if (!day_obj.thunder) day_obj.thunder = icon_id.search("_thunder_") > -1;
                for (let severe in severe_mapping) {
                    if (icon_id.search(severe) > 0) {
                        let level = severe_mapping[severe];
                        if (level > day_obj.severe_max) day_obj.severe_max = level;
                    }
                }
                for (let strength in strength_mapping) {
                    if (icon_id.search(strength) > 0) {
                        let level = strength_mapping[strength];
                        if (level > day_obj.strength_max) day_obj.strength_max = level;
                    }
                }
                cloud_cover_percent = 0;
                for (let cover in cover_mapping) {
                    if (icon_id.search(cover) > 0) {
                        let level = cover_mapping[cover];
                        day_obj.cover_sum  += level;
                        day_obj.cover_count++;
                        cloud_cover_percent = cover_percent_mapping[cover];
                    }
                }
                if (cloud_cover_percent !== undefined){
                    day_obj.cover_percent.push(cloud_cover_percent); // only a guess, let's see how well it works
                }
            }

            // enrich the hourly graph with the data: 
            for (let add = 0; add < 3; add++){
                let time_t = obj_t.t_epoch_local + add * 3600;
                let obj_h = c_hourly_map[time_t];
                if (debug){
                    console.log("3hour obj", obj_t.t_epoch_local, time_t, obj_h);
                }
                if (obj_h){
                    obj_h.wind_kmh     = wind_kmh;
                    obj_h.wind_dir_deg = wind_dir;
                    if (obj_t.temp !== undefined){
                        obj_h.temp_deg = parseFloat(obj_t.temp);
                    }
                    if (obj_t.temp_dew !== undefined){
                        obj_h.temp_dew = parseFloat(obj_t.temp_dew);
                    }
                    if (obj_t.humidity !== undefined){
                        obj_h.humidity = parseFloat(obj_t.humidity);
                    }
                    if (obj_t.wind_kmh !== undefined){
                        obj_h.wind_kmh = parseFloat(obj_t.wind_kmh);
                    }
                    if (cloud_cover_percent !== undefined){
                        obj_h.cloud_percent = cloud_cover_percent;
                    }
                }
            }
        }

        function inverseGet(obj: {[key: string]: number}, id: number) {
            let ret = "";
            for (let elem in obj) {
                if (obj[elem] === id) {
                    ret = elem;
                }
            }
            return ret;
        }

        for (let day_time_str in daily_weather_tmp) {
            let weather_tmp = daily_weather_tmp[day_time_str];
            if (debug){
                console.log("weather_tmp: " + weather_tmp);
            }

            let cover = (weather_tmp.cover_count > 0) ? Math.ceil(weather_tmp.cover_sum/ weather_tmp.cover_count) : 0;

            let icon_id_new = (weather_tmp.daylight ? "day" : "night") +
                (weather_tmp.thunder ? "_thunder" : "")
                + (weather_tmp.severe_max <= 3 ?
                    inverseGet(severe_mapping, weather_tmp.severe_max)
                    : ((weather_tmp.rain && weather_tmp.snow) ? "_snowrain" : (weather_tmp.snow ? "_snow" : "_rain")))
                + (weather_tmp.strength_max >= 0 ? inverseGet(strength_mapping, weather_tmp.strength_max) : "")
                + (weather_tmp.cover_sum >= 0 ? inverseGet(cover_mapping, cover) : "")
            let obj_i = daily_data_map[day_time_str];
            if (obj_i) {
                obj_i.icon_id = icon_id_new;
            }
        }

        for (let day_time_str in daily_wind_tmp) {
            let wind_obj_t = daily_wind_tmp[day_time_str];
            let avg_kmh = wind_obj_t.count > 0 ? wind_obj_t.sum_kmh / wind_obj_t.count : -1;
            let max_kmh = wind_obj_t.max_kmh;
            let dir_avg = wind_obj_t.vect_x >= 0 ?
                (90 - Math.atan(wind_obj_t.vect_y / (wind_obj_t.vect_x + 0.000000001)) / (Math.PI / 180))
                : (270 + Math.atan(wind_obj_t.vect_y / wind_obj_t.vect_x) / (Math.PI / 180));

            let humid_obj_t = daily_humidity_tmp[day_time_str];
            let humid_avg = humid_obj_t.count > 0 ? parseFloat((humid_obj_t.h_sum / humid_obj_t.count).toFixed(1)) : -1;

            let obj_i = daily_data_map[day_time_str];
            if (obj_i) {
                obj_i.wind_kmh = {
                    avg: parseFloat(avg_kmh.toFixed(1)),
                    max: parseFloat(max_kmh.toFixed(1)),
                    min: val_undef
                }
                obj_i.wind_dir = Math.round(dir_avg);
                obj_i.humidity = {
                    max: humid_obj_t.h_max,
                    min: humid_obj_t.h_min,
                    avg: humid_avg
                }
            }
        }
        
        for (let day in daily_weather_tmp){
            let day_w_tmp = daily_weather_tmp[day];
            let day_obj: TypesWeather.DataDay   = daily_data_map[day];
            if (day_obj && day_w_tmp.cover_percent.length > 0) {
                day_obj.cloud_cover = getMinMaxAvg(day_w_tmp.cover_percent); // computed from icons, but hey, more than nothing
                day_obj.conditions.rain    = day_w_tmp.rain;
                day_obj.conditions.snow    = day_w_tmp.snow;     // computed from icons, but hey, more than nothing
                day_obj.conditions.thunder = day_w_tmp.thunder;  // computed from icons, but hey, more than nothing
            }
        }

        let c_time: TypesWeather.DataTimes = {
            t_epoch_utc:   Math.round(t_now_epoch       * 1000),
            t_iso_utc:     moment(t_now_epoch       * 1000).utc().toISOString(),
        };
        let c_hourly_resolution: TypesWeather.DataHourlyResolution = {
            sunshine: { resolution: 1, offset: 0},
            humidity: { resolution: 3, offset: 0},
            wind:     { resolution: 3, offset: 0},
            temp:     { resolution: 3, offset: 0},
            precipitation: { resolution: 3, offset: 0},
        };

        console.log(log_prefix + `Postprocess for Station ${station_id} took ${(Date.now() - t_global_start)} ms`);

        return {
            current: c_current,
            daily_arr:  Object.keys(daily_data_map).sort().map(t_str => daily_data_map[t_str]),
            hourly_arr: Object.keys(c_hourly_map).sort().map(t_str   => c_hourly_map[t_str]),
            info: c_info,
            time: c_time,
            hourly_resolution: c_hourly_resolution
        };
    }

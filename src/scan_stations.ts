import { Script } from "@script_types/script/script";
import { Helper } from "./helper";
import { StationProcess } from "./scan_station_process";

import * as xpath from 'xpath';
import { DOMParser as dom } from 'xmldom';
import { CtxStorage } from "@script_types/script/context_data/context_storage";

export interface MeteMediaStation { id: string, name: string | null, country: string | null, lat: string | null, lon: string | null, url: string};

export interface ScanStationInfo {
    process_count: number,
    seen_station_urls: {[url: string]: number};
    city_urls: string[];
    req_city_count: number;
    req_count: number;
    req_backoff: number;
    problematic_urls: {[url: string]: string};
    stations: {[stationid: string]: MeteMediaStation}
}

type StationMap = {[stationid: string]: MeteMediaStation};
interface StationsFileContent {
    stations: StationMap;
    time_js: number;
}

export class Stations {
    private static storeIdStations = "stations";
    private ctx: Script.Context;
    private storage: CtxStorage.API;

    public base_url: string;
    public scan_lines: string[] = [];
    public processor: StationProcess;

    public station_map: StationMap = {};

    private stations_time_js: number | undefined;

    constructor(base_url: string, ctx: Script.Context){
        this.base_url = base_url;
        this.ctx = ctx;
        this.storage = ctx.data.storage;
        this.processor = new StationProcess(this);
    }

    public lastStationUpdate = (): number | undefined => {
        return this.stations_time_js;
    }

    private scanRequest = (city: number, info: ScanStationInfo, url: string, callback_body: (info: ScanStationInfo, body: string, url_was: string) => void) => {
        const log_prefix = "scanRequest: ";
        // Do not log here, before the real request => would over pollute the log!
        if (info.req_count > 10) {
            info.req_backoff++;
            setTimeout(() => {
                this.scanRequest(city, info, url, callback_body); info.req_backoff--;
            }, 500);
        } else {
            info.req_count++;
            info.req_city_count += city;
            console.log(log_prefix + "RequestUrl:", url, " Req_count: " + info.req_count);
            this.ctx.data.http.getStr(url, 30000, {
                'content-type': 'application/x-www-form-urlencoded'
            }).then(resp => {
                console.log(log_prefix + "RequestUrl:", url, " resp.statusCode: ", resp.statusCode);
                if (resp.body && !resp.error){
                    callback_body(info, resp.body, url);
                } else {
                    console.log(log_prefix + "Error: ", resp.error ? resp.error.substr(0,100) : undefined);
                    info.problematic_urls[url] = "DownloadIssue";
                }
                info.req_count--;
                info.req_city_count -= city;
            })
        }
    }

    public scanForStations (info: ScanStationInfo | undefined) {
        const log_prefix = "scanForStations: ";

        if (!info) {
            console.log(log_prefix + "no process_count ...")
            this.scan_lines = [];
            info = { 
                stations: {},
                city_urls: [],
                problematic_urls: {},
                process_count: 0,
                req_backoff: 0,
                req_city_count: 0,
                req_count: 0,
                seen_station_urls: {} 
            };
            for (let i = 0; i < 800; i++) {
                let url = this.base_url + "/de////map/" + i + "/#sytl;";
                this.scanRequest(0, info, url, this.processMap);
            }
        }

        if (info.req_count <= 0 && info.process_count <= 0 && info.req_backoff <= 0) {
            if (info.city_urls.length > 0) {
                console.log("Found number of URLs: " + info.city_urls.length);
                this.cityUrlWorker(info);
                setTimeout( () => { this.scanForStations(info); }, 2000);
            } else {
                console.log("Scanning Stations finished");
                console.log("info.stations: " + info.stations);
                this.writeStationsToFile(info.stations, new Date().getTime());
            }
        } else {
            console.log("\nreq_count: " + info.req_count + "  process_count: " + info.process_count + "   req_backoff: " + info.req_backoff + "\n");
            setTimeout(() => { 
                this.scanForStations(info); 
            }, 2000);
        }
    }

    private processMap = (info: ScanStationInfo, body: string, url_was: string) => {
        const log_prefix = "processMap: ";
        info.process_count++;
        let cleanedXml = Helper.getCleanedXML(body);
        console.log(log_prefix + "Process " + url_was);
        let doc = new dom().parseFromString(cleanedXml);
        let success = doc && doc.firstChild && doc.firstChild.nodeName == "HTML";
        console.log(log_prefix + "Found HTML Start Tag: " + success);

        let city_links = <Node[]> xpath.select(".//a[@class='city_link']", doc);
        let url_count = 0;
        for (let s in city_links) {
            let doc_city = city_links[s];
            let href = <Attr> xpath.select1("@href", doc_city);
            let url = href ? this.base_url + href.value : undefined;
            //console.log("City Link:",url);
            if (url) {
                url_count++;
                info.city_urls.push(url);
                //scanRequest(info,url,processCity);
            }
        }
        console.log(log_prefix + "  Found City Links: " + url_count);
        info.process_count--;
    }

    private cityUrlWorker = (info: ScanStationInfo) => {
        let self = this;
        if (info.req_city_count > 5) {
            console.log("req_city_count: " + info.req_city_count);
            setTimeout(() => { 
                self.cityUrlWorker(info); 
            }, 500);
        } else {
            if (info.city_urls.length > 0) {
                let url = info.city_urls.pop();
                if (url) {
                    this.scanRequest(1, info, url, this.processCity);
                    this.cityUrlWorker(info);
                }
            }
        }
    }

      
    private processCity = (info: ScanStationInfo, body: string, _url_was: string) => {
        info.process_count++;
        let cleanedXml = Helper.getCleanedXML(body);
        let doc = new dom().parseFromString(cleanedXml);

        let near_stations = <Node[]> xpath.select(".//div[@class='near-station']/a", doc);
        for (let s in near_stations) {
            let href = <Attr>xpath.select1("@href", near_stations[s]);
            let url: string | undefined = href ? this.base_url + href.value : undefined;
            if (url) {
                if (!info.seen_station_urls.hasOwnProperty(url)) {
                    console.log("Found New Station Link (List):", url);
                    info.seen_station_urls[url] = 1;
                    this.scanRequest(0, info, url, this.processor.processStation);
                }
            }
        }
        let stationUrl = this.processor.getStationUrlFromDoc(doc);
        if (stationUrl) {
            if (!info.seen_station_urls.hasOwnProperty(stationUrl)) {
                console.log("Found New Station Link (Main):", stationUrl);
                info.seen_station_urls[stationUrl] = 1;
                this.scanRequest(0, info, stationUrl, this.processor.processStation);
            }
        }
        info.process_count--;
    }

 

    public  writeStationsToFile (stations_t: {[stationid: string]: MeteMediaStation}, time_js: number) {
        const data: StationsFileContent = { stations: stations_t, time_js: time_js };
        this.storage.writeObj(Stations.storeIdStations, data);
    }


    public async readStationsFromFile () {
        let data = await this.storage.readObj<StationsFileContent>(Stations.storeIdStations);
        if (data){
            this.station_map = data.stations;
            this.stations_time_js = data.time_js;
            console.log("# Stations from file: ", Object.keys(this.station_map).length);
        } else {
            console.log("No stations in storage yet!");
        }
    }

    public updateStations = (force?: 'force') => {
        const log_prefix = "updateStations: ";
        let udate_every_days = 7;
        let update_every_ms = udate_every_days * 24 * 60 * 60 * 1000;

        let age_info_ms = this.stations_time_js ? (new Date().getTime()) - this.stations_time_js : undefined;
        console.log(log_prefix + "age_info_ms: " + (age_info_ms ? age_info_ms / 1000 / 60 : undefined) + " minutes - update only if > than " + update_every_ms / 1000 / 60 + " minutes");
        if (!age_info_ms || age_info_ms > update_every_ms || force === 'force') {
            console.log(log_prefix + "do it: scan for stations ...");
            this.scanForStations(undefined);
        } else {
            console.log(log_prefix + "no update needed");
        }
    }
}


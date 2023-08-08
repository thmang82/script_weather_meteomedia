import { Helper } from "./helper";
import { ScanStationInfo, Stations } from "./scan_stations";

import * as xpath from 'xpath';
import { DOMParser as dom } from 'xmldom';

export class StationProcess {

    private stations_: Stations;

    constructor(stations_: Stations){
        this.stations_ = stations_;
    }

  public getStationUrlFromDoc = (doc: Node) => {
    let doc_station = <Node> xpath.select1(".//div[@class='weather-station-info']/a", doc);
    let href = doc_station ? <Attr> xpath.select1("@href", doc_station) : undefined;
    let url = href ? this.stations_.base_url + href.value : undefined;
    return url;
    }
    public getStationUrlFromDocV2 = (doc: Node) => {
        let doc_station = <Node> xpath.select1(".//link[@rel='canonical']/a", doc);
        let href = doc_station ? <Attr> xpath.select1("@href", doc_station) : undefined;
        let url = href ? this.stations_.base_url + href.value : undefined;
        return url;
    }
    public getStationIdFromUrl = (url: string) => {
        let matches = url.match(/.*details\/S([0-9]*)\/.*/i);
        let ret = null;
        if (matches && matches.length >= 2) {
            ret = matches[1];
        }
        return ret;
    }
    private getNodeFirstChildValue = (doc: Node | undefined): string | null => {
        if (doc && doc.firstChild) {
            return doc.firstChild.nodeValue;
        } else {
            // console.log("getNodeFirstChildValue, no doc.firstChild", doc);
            return null;
        }
    }

    public processStation = (info: ScanStationInfo, body: string, url_was: string) => {
        info.process_count++;
        let cleanedXml = Helper.getCleanedXML(body);
        let doc = new dom().parseFromString(cleanedXml);

        let doc_loc = <Node> xpath.select1(".//div[@class='weather-detail-location']", doc);
        let station_name = this.getNodeFirstChildValue(doc_loc);
        let doc_country =  <Node> xpath.select1(".//div[@class='weather-detail-location-info']", doc);
        let country = this.getNodeFirstChildValue(doc_country);
        let doc_geo = <Node> xpath.select1(".//meta[@name='geo.position']", doc);
        let lat = null;
        let lon = null;
        if (doc_geo) {
            let geo_location = (<Attr> xpath.select1("@content", doc_geo)).value;
            let geo_matches = geo_location.match(/([0-9\.-]+);([0-9\.-]*)/i);
            if (geo_matches && geo_matches.length >= 3) {
                lat = geo_matches[1];
                lon = geo_matches[2];
            }
        }
        let stationUrl = this.getStationUrlFromDoc(doc);
        if (!stationUrl) {
            stationUrl = this.getStationUrlFromDocV2(doc);
        }
        let ID = stationUrl ? this.getStationIdFromUrl(stationUrl) : null;

        
        let line_str = "Nr " + this.stations_.scan_lines.length + " - " + ID + " - " + country + " - " + station_name + " - " + lat + "," + lon;
        console.log("Processed Station: " + line_str);
        this.stations_.scan_lines.push(line_str);
        let id_s = "S" + ID;
        if (!ID || !country || !lat || !lon || !station_name) {
            console.warn("Problematic request! id: ", id_s, "name:", station_name, "country:", country, "lat:", lat, "lon:", lon, "url:", url_was);
            info.problematic_urls[url_was] = "ParseIssue";
        }
        if (ID && !info.stations.hasOwnProperty(id_s) && id_s && station_name && lat && lon) {
            info.stations[id_s] = { id: id_s, name: station_name, country: country, lat: lat, lon: lon, url: url_was };
        };
        info.process_count--;
    }
}
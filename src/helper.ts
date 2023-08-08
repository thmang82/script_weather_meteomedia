

export namespace Helper {
    export function getCleanedXML (xml: string) {
        let cleanedXml = xml.replace("\ufeff", "");
        cleanedXml = cleanedXml.replace(/&nbsp;/g, ' '); // replaces &nbsp; 
        cleanedXml = cleanedXml.replace(/&copy;/g, ' ');
        return cleanedXml;
    }
}
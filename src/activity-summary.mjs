import {isIP} from 'node:net';
import {getDomain} from 'tldts';
export const website=host=>isIP(host)?host:getDomain(host,{allowPrivateDomains:true})||host;

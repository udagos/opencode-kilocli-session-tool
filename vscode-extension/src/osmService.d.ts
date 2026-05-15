export interface ISession {
    sid: string;
    title: string;
    display_title: string;
    directory: string;
    created_at: number | null;
    updated_at: number | null;
}
export declare class OsmService {
    constructor();
    /**
     * Fetch sessions from the configured osm backend
     */
    fetchSessions(): Promise<ISession[]>;
}
//# sourceMappingURL=osmService.d.ts.map
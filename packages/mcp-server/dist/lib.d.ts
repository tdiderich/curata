export declare function slugify(title: string): string;
export interface ApiResponse {
    result?: unknown;
    error?: string;
}
export declare function callApi(baseUrl: string, apiKey: string, tool: string, args: Record<string, string>): Promise<ApiResponse>;
interface SearchResult {
    slug: string;
    title: string;
    matches: string[];
}
export declare function formatSearchResults(results: SearchResult[], query: string): string;
export declare function formatPageList(pages: Array<Record<string, unknown>>): string;
export declare function formatPageDetail(page: Record<string, unknown>): string;
export {};

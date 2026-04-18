declare module 'duckduckgo-images-api' {
  interface DDGImageResult {
    image: string;
    thumbnail: string;
    title: string;
    url: string;
    height: number;
    width: number;
    source: string;
  }

  interface DDGSearchOpts {
    query: string;
    moderate?: boolean;
    iterations?: number;
    retries?: number;
  }

  export function image_search(opts: DDGSearchOpts): Promise<DDGImageResult[]>;
  export function image_search_generator(opts: DDGSearchOpts): AsyncGenerator<DDGImageResult[]>;
}

export const getMinMaxAvg = (array: number[]): { min: number, max: number, avg: number} | undefined => {
    const mma = new StatMinMaxAvg();
    array.forEach(e => mma.add(e));
    if (mma.min !== null && mma.max !== null && mma.avg !== null){
        return { min: mma.min, max: mma.max, avg: mma.avg }
    }
    return undefined;
}
export class StatMinMaxAvg {
    public min: number | null = null; 
    public max: number | null = null;
    public avg: number | null = null;
    public varianz: number | null = null;
    public stddev: number | null = null;
    private avg_sum = 0;
    private square_sum = 0;
    public count = 0;
    add(val: number): void {
        if (val !== null){
            this.varianz = null;
            this.stddev = null;
            this.avg_sum += val;
            this.square_sum += val * val;
            this.count ++;
            if (this.count > 0){
                this.avg = this.avg_sum / this.count;
            }
            if (this.min == null || val < this.min) this.min = val;
            if (this.max == null || val > this.max) this.max = val;
           
        }
    }
    computeVarianzAndSqrt(){
        if (this.count > 1){
            this.varianz = (this.square_sum - (this.avg_sum * this.avg_sum) / this.count) / (this.count - 1);
            this.stddev = Math.sqrt(this.varianz);
        }
    }
    clear(){
        this.min = null;
        this.max = null;
        this.avg = null;
        this.avg_sum = 0;
        this.square_sum = 0;
        this.varianz = null;
        this.stddev = null;
        this.count = 0;
    }
    toString(): string{
        return "min: "+ this.min + " max: "+ this.max + " (count: " + this.count + ")";
    }
}
package main

import (
	"context"
	"fmt"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
)

func handler(ctx context.Context, sqsEvent events.SQSEvent) error {
	for i := 0; i < len(sqsEvent.Records); i++ {
		record := sqsEvent.Records[i]
		fmt.Println(record)

	}
	return nil
}

func main() {
	lambda.Start(handler)
}

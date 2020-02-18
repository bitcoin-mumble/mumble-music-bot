
run:
	forever app.js --spinSleepTime 0 --minUptime 0

test:
	BOTNAME="[BUTestNetBot]" CHANN="OpenSource Island" node app.js
